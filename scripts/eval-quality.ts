/**
 * RAG 质量评估脚本 (重构版)
 * 
 * 核心指标:
 * - field_completeness_rate: 字段完整率
 * - citation_coverage_rate: 引用覆盖率
 * - citation_validity_rate: 引用有效率
 * - latency_p95: P95延迟
 * - error_rate: 错误率
 * - stability_score: 稳定性得分
 * 
 * 用法: npx tsx scripts/eval-quality.ts [--baseline] [--compare <file>]
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

// ============================================================
// 类型定义
// ============================================================

interface TestCase {
    id: string;
    group: string;
    plan_input: string;
    question: string;
    expected_field: string;
    field_type: 'single' | 'array';
    should_have_citation: string;
    notes: string;
}

interface APIResponse {
    productName?: { value: string; sourceClauseId: number | null } | string;
    overview?: { value: string; sourceClauseId: number | null } | string;
    coreCoverage?: { title: string; value: string; desc: string; sourceClauseId: number | null }[];
    exclusions?: { value: string; sourceClauseId: number | null }[];
    targetAudience?: { value: string; sourceClauseId: number | null } | string;
    salesScript?: string[];
    sources?: { clauseId: number; productName: string | null }[];
    clauseMap?: Record<number, { snippet: string; productName: string | null }>;
    notFound?: { query: string; reason: string };
    error?: string;
    _cached?: boolean;
}

interface EvalResult {
    case_id: string;
    query: string;
    latency_ms: number;
    has_error: boolean;
    error_message?: string;
    field_exists: boolean;
    field_complete: boolean;
    has_citation: boolean;
    citation_valid: boolean;
    citation_count: number;
    raw_response?: APIResponse;
}

interface QualityMetrics {
    // 核心指标
    field_completeness_rate: number;    // 字段完整率
    citation_coverage_rate: number;      // 引用覆盖率
    citation_validity_rate: number;      // 引用有效率
    latency_avg_ms: number;
    latency_p50_ms: number;
    latency_p95_ms: number;
    latency_max_ms: number;
    error_rate: number;
    stability_score: number;             // 稳定性得分

    // 扩展指标
    total_cases: number;
    successful_cases: number;
    avg_citation_count: number;
}

interface QualityReport {
    timestamp: string;
    version: string;
    metrics: QualityMetrics;
    results: EvalResult[];
    comparison?: {
        baseline_file: string;
        baseline_metrics: QualityMetrics;
        delta: Partial<QualityMetrics>;
    };
}

// ============================================================
// 配置
// ============================================================

const API_URL = process.env.API_URL || 'http://localhost:3000/api/search';
const REQUEST_DELAY_MS = 300;

// 稳定性测试缓存
const stabilityCache = new Map<string, APIResponse>();

// ============================================================
// 核心函数
// ============================================================

async function queryAPI(query: string): Promise<{ response: APIResponse | null; latency: number; error?: string }> {
    const start = Date.now();

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, matchCount: 10, matchThreshold: 0.1 }),
        });

        const latency = Date.now() - start;

        if (!res.ok) {
            return { response: null, latency, error: `HTTP ${res.status}` };
        }

        const data = await res.json();
        return { response: data, latency };
    } catch (err: any) {
        return { response: null, latency: Date.now() - start, error: err.message };
    }
}

function checkFieldComplete(response: APIResponse, fieldName: string, fieldType: 'single' | 'array'): boolean {
    const field = (response as any)[fieldName];
    if (!field) return false;

    if (fieldType === 'array') {
        if (!Array.isArray(field)) return false;
        return field.length >= 2;
    } else {
        if (typeof field === 'object' && field.value) {
            return field.value.length >= 10;
        }
        return false;
    }
}

function countCitations(response: APIResponse): { count: number; fields: string[] } {
    const fields: string[] = [];
    let count = 0;

    const checkField = (field: string, value: any) => {
        if (value && typeof value === 'object' && 'sourceClauseId' in value && value.sourceClauseId != null) {
            fields.push(field);
            count++;
        }
    };

    checkField('productName', response.productName);
    checkField('overview', response.overview);
    checkField('targetAudience', response.targetAudience);

    if (Array.isArray(response.coreCoverage)) {
        response.coreCoverage.forEach((item, i) => {
            if (item.sourceClauseId != null) {
                fields.push(`coreCoverage[${i}]`);
                count++;
            }
        });
    }

    if (Array.isArray(response.exclusions)) {
        response.exclusions.forEach((item, i) => {
            if (typeof item === 'object' && item.sourceClauseId != null) {
                fields.push(`exclusions[${i}]`);
                count++;
            }
        });
    }

    return { count, fields };
}

function checkCitationValid(response: APIResponse): boolean {
    const clauseMap = response.clauseMap || {};
    const citations = countCitations(response);

    // 检查所有引用的clauseId是否在clauseMap中存在
    for (const field of citations.fields) {
        const parts = field.match(/^(\w+)(?:\[(\d+)\])?$/);
        if (!parts) continue;

        const fieldName = parts[1];
        const index = parts[2] ? parseInt(parts[2]) : undefined;

        const fieldValue = (response as any)[fieldName];
        if (!fieldValue) return false;

        let clauseId: number | null = null;
        if (index !== undefined && Array.isArray(fieldValue)) {
            clauseId = fieldValue[index]?.sourceClauseId;
        } else if (typeof fieldValue === 'object' && 'sourceClauseId' in fieldValue) {
            clauseId = fieldValue.sourceClauseId;
        }

        if (clauseId !== null && !(clauseId in clauseMap)) {
            return false;
        }
    }

    return true;
}

function calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
}

function calculateMetrics(results: EvalResult[], testCases: TestCase[]): QualityMetrics {
    const successfulResults = results.filter(r => !r.has_error);
    const latencies = successfulResults.map(r => r.latency_ms);

    const citationResults = successfulResults.filter(r => r.has_citation);
    const validCitationResults = successfulResults.filter(r => r.citation_valid);

    // 稳定性测试结果
    const groupC = results.filter((r, i) => testCases[i]?.group === 'C');
    const stableResults = groupC.filter(r => !r.has_error && r.field_complete);

    return {
        field_completeness_rate: successfulResults.length > 0
            ? (successfulResults.filter(r => r.field_complete).length / successfulResults.length) * 100
            : 0,
        citation_coverage_rate: successfulResults.length > 0
            ? (citationResults.length / successfulResults.length) * 100
            : 0,
        citation_validity_rate: citationResults.length > 0
            ? (validCitationResults.length / citationResults.length) * 100
            : 0,
        latency_avg_ms: latencies.length > 0
            ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
            : 0,
        latency_p50_ms: calculatePercentile(latencies, 50),
        latency_p95_ms: calculatePercentile(latencies, 95),
        latency_max_ms: latencies.length > 0 ? Math.max(...latencies) : 0,
        error_rate: results.length > 0
            ? (results.filter(r => r.has_error).length / results.length) * 100
            : 0,
        stability_score: groupC.length > 0
            ? (stableResults.length / groupC.length) * 100
            : 0,
        total_cases: results.length,
        successful_cases: successfulResults.length,
        avg_citation_count: citationResults.length > 0
            ? Math.round(citationResults.reduce((a, r) => a + r.citation_count, 0) / citationResults.length * 10) / 10
            : 0,
    };
}

function formatTable(metrics: QualityMetrics, comparison?: QualityReport['comparison']): string {
    const lines: string[] = [];

    lines.push('┌──────────────────────────┬──────────────┬──────────────┬──────────────┐');
    lines.push('│ 指标                     │ 当前值       │ 基线值       │ 变化         │');
    lines.push('├──────────────────────────┼──────────────┼──────────────┼──────────────┤');

    const formatRow = (label: string, current: number | undefined, unit: string, key: keyof QualityMetrics) => {
        const currentStr = current !== undefined ? `${current.toFixed(1)}${unit}` : 'N/A';
        let baselineStr = 'N/A';
        let deltaStr = '-';

        if (comparison?.baseline_metrics) {
            const baseline = comparison.baseline_metrics[key] as number | undefined;
            if (baseline !== undefined) {
                baselineStr = `${baseline.toFixed(1)}${unit}`;
                if (current !== undefined) {
                    const delta = current - baseline;
                    const sign = delta >= 0 ? '+' : '';
                    const color = key === 'error_rate' || key.includes('latency')
                        ? (delta <= 0 ? '🟢' : '🔴')
                        : (delta >= 0 ? '🟢' : '🔴');
                    deltaStr = `${color} ${sign}${delta.toFixed(1)}${unit}`;
                }
            }
        }

        lines.push(`│ ${label.padEnd(24)} │ ${currentStr.padEnd(12)} │ ${baselineStr.padEnd(12)} │ ${deltaStr.padEnd(12)} │`);
    };

    formatRow('字段完整率', metrics.field_completeness_rate, '%', 'field_completeness_rate');
    formatRow('引用覆盖率', metrics.citation_coverage_rate, '%', 'citation_coverage_rate');
    formatRow('引用有效率', metrics.citation_validity_rate, '%', 'citation_validity_rate');
    formatRow('latency_avg', metrics.latency_avg_ms, 'ms', 'latency_avg_ms');
    formatRow('latency_p50', metrics.latency_p50_ms, 'ms', 'latency_p50_ms');
    formatRow('latency_p95', metrics.latency_p95_ms, 'ms', 'latency_p95_ms');
    formatRow('latency_max', metrics.latency_max_ms, 'ms', 'latency_max_ms');
    formatRow('error_rate', metrics.error_rate, '%', 'error_rate');
    formatRow('稳定性得分', metrics.stability_score, '%', 'stability_score');

    lines.push('└──────────────────────────┴──────────────┴──────────────┴──────────────┘');

    lines.push('');
    lines.push(`总用例数: ${metrics.total_cases} | 成功: ${metrics.successful_cases} | 平均引用数: ${metrics.avg_citation_count}`);

    return lines.join('\n');
}

// ============================================================
// 主流程
// ============================================================

async function runEvaluation(options: { baseline?: boolean; compareFile?: string }) {
    console.log('🚀 RAG 质量评估开始...\n');

    const evalSetPath = path.join(process.cwd(), 'data', 'eval_set.csv');
    if (!fs.existsSync(evalSetPath)) {
        console.error(`❌ 找不到测试集: ${evalSetPath}`);
        process.exit(1);
    }

    const csvContent = fs.readFileSync(evalSetPath, 'utf-8');
    const testCases: TestCase[] = parse(csvContent, { columns: true, skip_empty_lines: true });

    console.log(`📋 加载 ${testCases.length} 条测试用例\n`);

    const results: EvalResult[] = [];

    for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        const query = `【${tc.plan_input}】${tc.question}`;

        process.stdout.write(`[${i + 1}/${testCases.length}] ${query.slice(0, 40).padEnd(40)} `);

        const { response, latency, error } = await queryAPI(query);

        const result: EvalResult = {
            case_id: tc.id,
            query,
            latency_ms: latency,
            has_error: !!error || !!response?.error || !!response?.notFound,
            error_message: error || response?.error || (response?.notFound ? 'NOT_FOUND' : undefined),
            field_exists: false,
            field_complete: false,
            has_citation: false,
            citation_valid: false,
            citation_count: 0,
        };

        if (response && !response.error && !response.notFound) {
            result.field_exists = !!(response as any)[tc.expected_field];
            result.field_complete = checkFieldComplete(response, tc.expected_field, tc.field_type);

            const citations = countCitations(response);
            result.has_citation = citations.count > 0;
            result.citation_count = citations.count;
            result.citation_valid = checkCitationValid(response);
        }

        const status = result.has_error ? '❌' : (result.field_complete && result.has_citation ? '✅' : '⚠️');
        console.log(`${status} ${latency}ms | citations: ${result.citation_count}`);

        results.push(result);

        await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    }

    const metrics = calculateMetrics(results, testCases);

    let comparison: QualityReport['comparison'] | undefined;
    if (options.compareFile) {
        try {
            const baselineContent = fs.readFileSync(options.compareFile, 'utf-8');
            const baselineReport: QualityReport = JSON.parse(baselineContent);
            comparison = {
                baseline_file: options.compareFile,
                baseline_metrics: baselineReport.metrics,
                delta: {},
            };
        } catch (err) {
            console.warn(`\n⚠️ 无法加载基线文件: ${options.compareFile}`);
        }
    }

    console.log('\n' + '═'.repeat(70));
    console.log('📊 RAG 质量评估报告');
    console.log('═'.repeat(70) + '\n');
    console.log(formatTable(metrics, comparison));

    const outputDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const reportPath = options.baseline
        ? path.join(outputDir, 'baseline_quality.json')
        : path.join(outputDir, `quality_${timestamp}.json`);

    const report: QualityReport = {
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        metrics,
        results,
        comparison,
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\n💾 报告已保存: ${reportPath}`);

    if (options.baseline) {
        console.log('\n✅ 已保存为基线文件，后续评估可使用 --compare outputs/baseline_quality.json 进行对比');
    }

    const errors = results.filter(r => r.has_error);
    if (errors.length > 0) {
        console.log('\n❌ 错误详情:');
        errors.slice(0, 5).forEach(e => {
            console.log(`  [${e.case_id}] ${e.query}: ${e.error_message}`);
        });
        if (errors.length > 5) {
            console.log(`  ... 还有 ${errors.length - 5} 条错误`);
        }
    }
}

// ============================================================
// CLI 入口
// ============================================================

const args = process.argv.slice(2);
const options = {
    baseline: args.includes('--baseline'),
    compareFile: args.includes('--compare') ? args[args.indexOf('--compare') + 1] : undefined,
};

if (args.includes('--help')) {
    console.log(`
RAG 质量评估脚本 (生产级)

用法:
  npx tsx scripts/eval-quality.ts [选项]

选项:
  --baseline       保存结果为基线文件
  --compare <file> 与基线文件对比
  --help           显示帮助

示例:
  # 首次运行，保存基线
  npx tsx scripts/eval-quality.ts --baseline

  # 修改后对比基线
  npx tsx scripts/eval-quality.ts --compare outputs/baseline_quality.json
`);
    process.exit(0);
}

runEvaluation(options).catch(err => {
    console.error('评估失败:', err);
    process.exit(1);
});
