/**
 * RAG 生产级评估脚本 (简化版)
 * 
 * 业务场景: 用户选择产品 → 系统提取完整信息卡片
 * 
 * 评估重点:
 * - 信息完整性: 所有必填字段是否存在
 * - 引用覆盖率: 所有字段是否有sourceClauseId
 * - 稳定性: 同一产品多次查询结果一致性
 * 
 * 用法: npx tsx scripts/eval.ts
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

// ============================================================
// 类型定义
// ============================================================

interface TestCase {
    id: string;
    product_name: string;
    test_type: 'complete' | 'stability';
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
}

interface EvalResult {
    case_id: string;
    product_name: string;
    test_type: string;
    has_error: boolean;
    error_message?: string;
    // 信息完整性
    has_product_name: boolean;
    has_overview: boolean;
    has_core_coverage: boolean;
    has_exclusions: boolean;
    has_target_audience: boolean;
    has_sales_script: boolean;
    // 引用覆盖率
    product_name_cited: boolean;
    overview_cited: boolean;
    core_coverage_cited: boolean;
    exclusions_cited: boolean;
    target_audience_cited: boolean;
    // 整体评分
    completeness_score: number;
    citation_score: number;
    pass: boolean;
    reason: string;
}

interface EvalMetrics {
    total: number;
    // 信息完整性
    avg_completeness_score: number;
    // 引用覆盖率
    avg_citation_score: number;
    // 稳定性
    stability_pass_rate: number;
    // 整体
    overall_pass_rate: number;
}

// ============================================================
// 配置
// ============================================================

const API_URL = process.env.API_URL || 'http://localhost:3000/api/search';
const REQUEST_DELAY_MS = 500;

// 稳定性测试缓存
const stabilityCache = new Map<string, APIResponse>();

// ============================================================
// 核心函数
// ============================================================

async function queryAPI(productName: string): Promise<APIResponse | null> {
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: productName, matchCount: 10, matchThreshold: 0.1 }),
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        return await res.json();
    } catch (err: any) {
        console.error(`[Eval] API call failed:`, err.message);
        return null;
    }
}

function checkFieldExists(response: APIResponse, fieldName: string): boolean {
    const field = (response as any)[fieldName];
    if (!field) return false;

    if (Array.isArray(field)) {
        return field.length > 0;
    }

    if (typeof field === 'object' && field.value) {
        return field.value.length > 0 && field.value !== '[条款未说明]';
    }

    return false;
}

function checkFieldCited(response: APIResponse, fieldName: string): boolean {
    const field = (response as any)[fieldName];
    if (!field) return false;

    if (Array.isArray(field)) {
        // 数组类型,检查是否至少有一个元素有sourceClauseId
        return field.some((item: any) =>
            typeof item === 'object' && item.sourceClauseId != null
        );
    } else if (typeof field === 'object' && 'sourceClauseId' in field) {
        return field.sourceClauseId != null;
    }

    return false;
}

function evaluateCase(testCase: TestCase, apiResponse: APIResponse | null): EvalResult {
    const result: EvalResult = {
        case_id: testCase.id,
        product_name: testCase.product_name,
        test_type: testCase.test_type,
        has_error: false,
        error_message: undefined,
        has_product_name: false,
        has_overview: false,
        has_core_coverage: false,
        has_exclusions: false,
        has_target_audience: false,
        has_sales_script: false,
        product_name_cited: false,
        overview_cited: false,
        core_coverage_cited: false,
        exclusions_cited: false,
        target_audience_cited: false,
        completeness_score: 0,
        citation_score: 0,
        pass: false,
        reason: '',
    };

    if (!apiResponse || apiResponse.error || apiResponse.notFound) {
        result.has_error = true;
        result.error_message = apiResponse?.error || (apiResponse?.notFound ? 'NOT_FOUND' : 'API_ERROR');
        result.reason = '❌ API错误或未找到';
        return result;
    }

    // 检查字段存在性
    result.has_product_name = checkFieldExists(apiResponse, 'productName');
    result.has_overview = checkFieldExists(apiResponse, 'overview');
    result.has_core_coverage = checkFieldExists(apiResponse, 'coreCoverage');
    result.has_exclusions = checkFieldExists(apiResponse, 'exclusions');
    result.has_target_audience = checkFieldExists(apiResponse, 'targetAudience');
    result.has_sales_script = checkFieldExists(apiResponse, 'salesScript');

    // 检查引用
    result.product_name_cited = checkFieldCited(apiResponse, 'productName');
    result.overview_cited = checkFieldCited(apiResponse, 'overview');
    result.core_coverage_cited = checkFieldCited(apiResponse, 'coreCoverage');
    result.exclusions_cited = checkFieldCited(apiResponse, 'exclusions');
    result.target_audience_cited = checkFieldCited(apiResponse, 'targetAudience');

    // 计算完整性得分 (必填字段: productName, overview, coreCoverage, exclusions, targetAudience)
    const requiredFields = [
        result.has_product_name,
        result.has_overview,
        result.has_core_coverage,
        result.has_exclusions,
        result.has_target_audience,
    ];
    result.completeness_score = (requiredFields.filter(Boolean).length / requiredFields.length) * 100;

    // 计算引用得分 (salesScript不需要引用)
    const citedFields = [
        result.product_name_cited,
        result.overview_cited,
        result.core_coverage_cited,
        result.exclusions_cited,
        result.target_audience_cited,
    ];
    result.citation_score = (citedFields.filter(Boolean).length / citedFields.length) * 100;

    // 判断是否通过
    if (testCase.test_type === 'complete') {
        // 完整性测试: 完整性≥80% 且 引用率≥80%
        result.pass = result.completeness_score >= 80 && result.citation_score >= 80;
        result.reason = result.pass
            ? `✅ 完整性${result.completeness_score.toFixed(0)}% 引用率${result.citation_score.toFixed(0)}%`
            : `❌ 完整性${result.completeness_score.toFixed(0)}% 引用率${result.citation_score.toFixed(0)}%`;
    } else if (testCase.test_type === 'stability') {
        // 稳定性测试: 结果一致性
        const cacheKey = testCase.product_name;
        const cached = stabilityCache.get(cacheKey);

        if (!cached) {
            // 第一次查询,缓存结果
            stabilityCache.set(cacheKey, apiResponse);
            result.pass = result.completeness_score >= 80;
            result.reason = result.pass ? '✅ 首次查询成功' : '❌ 首次查询失败';
        } else {
            // 对比结果一致性 (只对比核心字段)
            const currentProductName = typeof apiResponse.productName === 'object' && apiResponse.productName !== null
                ? apiResponse.productName.value
                : apiResponse.productName;
            const cachedProductName = typeof cached.productName === 'object' && cached.productName !== null
                ? cached.productName.value
                : cached.productName;
            const isConsistent = currentProductName === cachedProductName;

            result.pass = isConsistent;
            result.reason = isConsistent ? '✅ 结果一致' : '❌ 结果不一致';
        }
    }

    return result;
}

function calculateMetrics(results: EvalResult[]): EvalMetrics {
    const completeTests = results.filter(r => r.test_type === 'complete' && !r.has_error);
    const stabilityTests = results.filter(r => r.test_type === 'stability');

    return {
        total: results.length,
        avg_completeness_score: completeTests.length > 0
            ? completeTests.reduce((sum, r) => sum + r.completeness_score, 0) / completeTests.length
            : 0,
        avg_citation_score: completeTests.length > 0
            ? completeTests.reduce((sum, r) => sum + r.citation_score, 0) / completeTests.length
            : 0,
        stability_pass_rate: stabilityTests.length > 0
            ? (stabilityTests.filter(r => r.pass).length / stabilityTests.length) * 100
            : 0,
        overall_pass_rate: (results.filter(r => r.pass).length / results.length) * 100,
    };
}

// ============================================================
// 主流程
// ============================================================

async function runEvaluation() {
    console.log('🚀 RAG 生产级评估开始...\n');

    // 读取测试集
    const evalSetPath = path.join(process.cwd(), 'data', 'eval_set.csv');
    const csvContent = fs.readFileSync(evalSetPath, 'utf-8');
    const testCases: TestCase[] = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
    });

    console.log(`📋 加载 ${testCases.length} 条测试用例\n`);

    // 执行测试
    const results: EvalResult[] = [];
    let processed = 0;

    for (const testCase of testCases) {
        processed++;
        console.log(`[${processed}/${testCases.length}] [${testCase.test_type}] ${testCase.product_name}`);

        const apiResponse = await queryAPI(testCase.product_name);
        const result = evaluateCase(testCase, apiResponse);
        results.push(result);

        console.log(`  ${result.reason}\n`);

        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
    }

    // 计算指标
    const metrics = calculateMetrics(results);

    // 输出报告
    console.log('\n' + '='.repeat(70));
    console.log('📊 RAG 生产级评估报告');
    console.log('='.repeat(70));
    console.log(`总测试数: ${metrics.total}`);
    console.log(`\n【信息完整性】`);
    console.log(`  平均完整性得分: ${metrics.avg_completeness_score.toFixed(1)}%`);
    console.log(`  平均引用覆盖率: ${metrics.avg_citation_score.toFixed(1)}%`);
    console.log(`\n【稳定性测试】`);
    console.log(`  稳定性通过率: ${metrics.stability_pass_rate.toFixed(1)}%`);
    console.log(`\n【整体】`);
    console.log(`  整体通过率: ${metrics.overall_pass_rate.toFixed(1)}%`);
    console.log('='.repeat(70));

    // 失败详情
    const failures = results.filter(r => !r.pass);
    if (failures.length > 0) {
        console.log('\n❌ 失败案例:');
        failures.forEach(f => {
            console.log(`  [${f.case_id}] ${f.product_name}`);
            console.log(`      ${f.reason}`);
        });
    }

    // 保存报告
    const outputDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const reportPath = path.join(outputDir, `eval_result_${timestamp}.json`);

    const report = {
        timestamp: new Date().toISOString(),
        metrics,
        results,
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\n💾 详细报告已保存至: ${reportPath}`);
}

runEvaluation().catch(error => {
    console.error('评估失败:', error);
    process.exit(1);
});
