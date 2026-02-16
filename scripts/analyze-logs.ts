/**
 * 日志分析脚本
 * 
 * 功能：统计每日请求量、P95 延迟、缓存命中率、错误率
 * 输出：终端表格 + outputs/log_analysis_YYYYMMDD.json
 * 
 * 用法：npx tsx scripts/analyze-logs.ts [--date YYYYMMDD]
 */

import * as fs from 'fs';
import * as path from 'path';

// ========== 类型定义 ==========
interface QueryLog {
    timestamp: string;
    request_id?: string;
    query: string;
    product_matched: string | null;
    retrieval_strategy?: string | null;
    cache_hit?: boolean;
    retrieved_chunks?: Array<{ id: number; similarity: number; snippet: string }>;
    top_k?: number;
    duration_ms?: number;
    embedding_ms?: number;
    llm_ms?: number;
    tokens_used?: { prompt: number; completion: number };
    should_refuse?: boolean;
    refuse_reason?: string | null;
    error_type?: string | null;
    error_message?: string | null;
}

interface AnalysisResult {
    date: string;
    totalRequests: number;
    uniqueQueries: number;
    cacheHitRate: string;
    errorRate: string;
    avgDuration: number;
    p50Duration: number;
    p95Duration: number;
    p99Duration: number;
    avgEmbeddingMs: number;
    avgLlmMs: number;
    totalTokensPrompt: number;
    totalTokensCompletion: number;
    topProducts: Array<{ name: string; count: number }>;
    retrievalStrategies: Record<string, number>;
    errorTypes: Record<string, number>;
    hourlyDistribution: Record<string, number>;
}

// ========== 工具函数 ==========

function parseArgs(): { date: string } {
    const args = process.argv.slice(2);
    let date = new Date().toISOString().split('T')[0].replace(/-/g, '');

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--date' && args[i + 1]) {
            date = args[i + 1];
        }
    }

    return { date };
}

function percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

function readLogFile(filePath: string): QueryLog[] {
    if (!fs.existsSync(filePath)) {
        return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    const logs: QueryLog[] = [];
    for (const line of lines) {
        try {
            logs.push(JSON.parse(line));
        } catch (e) {
            console.warn(`[Warn] Failed to parse line: ${line.slice(0, 50)}...`);
        }
    }

    return logs;
}

function formatTable(headers: string[], rows: string[][]): string {
    const colWidths = headers.map((h, i) => {
        const maxRowWidth = Math.max(...rows.map(r => (r[i] || '').length));
        return Math.max(h.length, maxRowWidth);
    });

    const hr = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
    const headerRow = '|' + headers.map((h, i) => ` ${h.padEnd(colWidths[i])} `).join('|') + '|';
    const dataRows = rows.map(r =>
        '|' + r.map((c, i) => ` ${(c || '').padEnd(colWidths[i])} `).join('|') + '|'
    );

    return [hr, headerRow, hr, ...dataRows, hr].join('\n');
}

// ========== 主函数 ==========

async function main() {
    console.log('📊 日志分析脚本启动...\n');

    const { date } = parseArgs();
    const logsDir = path.join(process.cwd(), 'logs');
    const outputDir = path.join(process.cwd(), 'outputs');

    // 确保输出目录存在
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // 读取日志文件
    const logFile = path.join(logsDir, `query_${date}.jsonl`);
    console.log(`📁 读取日志文件: ${logFile}`);

    const logs = readLogFile(logFile);

    if (logs.length === 0) {
        console.log(`⚠️ 没有找到 ${date} 的日志数据`);
        process.exit(0);
    }

    console.log(`📋 加载 ${logs.length} 条日志记录\n`);

    // ========== 计算统计指标 ==========

    // 基础统计
    const totalRequests = logs.length;
    const uniqueQueries = new Set(logs.map(l => l.query)).size;

    // 缓存命中率
    const cacheHits = logs.filter(l => l.cache_hit === true).length;
    const cacheHitRate = ((cacheHits / totalRequests) * 100).toFixed(1);

    // 错误率
    const errors = logs.filter(l => l.error_type || l.should_refuse).length;
    const errorRate = ((errors / totalRequests) * 100).toFixed(1);

    // 延迟统计
    const durations = logs.map(l => l.duration_ms || 0).filter(d => d > 0);
    const avgDuration = durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;
    const p50Duration = percentile(durations, 50);
    const p95Duration = percentile(durations, 95);
    const p99Duration = percentile(durations, 99);

    // Embedding 和 LLM 延迟
    const embeddingMs = logs.map(l => l.embedding_ms || 0).filter(d => d > 0);
    const avgEmbeddingMs = embeddingMs.length > 0
        ? Math.round(embeddingMs.reduce((a, b) => a + b, 0) / embeddingMs.length)
        : 0;

    const llmMs = logs.map(l => l.llm_ms || 0).filter(d => d > 0);
    const avgLlmMs = llmMs.length > 0
        ? Math.round(llmMs.reduce((a, b) => a + b, 0) / llmMs.length)
        : 0;

    // Token 统计
    let totalTokensPrompt = 0;
    let totalTokensCompletion = 0;
    for (const log of logs) {
        if (log.tokens_used) {
            totalTokensPrompt += log.tokens_used.prompt || 0;
            totalTokensCompletion += log.tokens_used.completion || 0;
        }
    }

    // 产品匹配统计
    const productCounts: Record<string, number> = {};
    for (const log of logs) {
        const product = log.product_matched || 'unknown';
        productCounts[product] = (productCounts[product] || 0) + 1;
    }
    const topProducts = Object.entries(productCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }));

    // 检索策略统计
    const retrievalStrategies: Record<string, number> = {};
    for (const log of logs) {
        const strategy = log.retrieval_strategy || 'unknown';
        retrievalStrategies[strategy] = (retrievalStrategies[strategy] || 0) + 1;
    }

    // 错误类型统计
    const errorTypes: Record<string, number> = {};
    for (const log of logs) {
        if (log.error_type) {
            errorTypes[log.error_type] = (errorTypes[log.error_type] || 0) + 1;
        }
    }

    // 每小时分布
    const hourlyDistribution: Record<string, number> = {};
    for (const log of logs) {
        const hour = log.timestamp?.slice(11, 13) || '00';
        hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1;
    }

    // ========== 输出结果 ==========

    const result: AnalysisResult = {
        date,
        totalRequests,
        uniqueQueries,
        cacheHitRate: `${cacheHitRate}%`,
        errorRate: `${errorRate}%`,
        avgDuration,
        p50Duration,
        p95Duration,
        p99Duration,
        avgEmbeddingMs,
        avgLlmMs,
        totalTokensPrompt,
        totalTokensCompletion,
        topProducts,
        retrievalStrategies,
        errorTypes,
        hourlyDistribution,
    };

    // 终端输出
    console.log('='.repeat(60));
    console.log(`📈 日志分析报告 - ${date}`);
    console.log('='.repeat(60));

    // 概览表格
    console.log('\n## 概览\n');
    console.log(formatTable(
        ['指标', '值'],
        [
            ['总请求数', String(totalRequests)],
            ['唯一查询数', String(uniqueQueries)],
            ['缓存命中率', `${cacheHitRate}%`],
            ['错误率', `${errorRate}%`],
        ]
    ));

    // 延迟表格
    console.log('\n## 延迟统计 (ms)\n');
    console.log(formatTable(
        ['指标', '值'],
        [
            ['平均延迟', String(avgDuration)],
            ['P50', String(p50Duration)],
            ['P95', String(p95Duration)],
            ['P99', String(p99Duration)],
            ['平均 Embedding', String(avgEmbeddingMs)],
            ['平均 LLM', String(avgLlmMs)],
        ]
    ));

    // Token 统计
    console.log('\n## Token 消耗\n');
    console.log(formatTable(
        ['类型', '数量'],
        [
            ['Prompt Tokens', String(totalTokensPrompt)],
            ['Completion Tokens', String(totalTokensCompletion)],
            ['总计', String(totalTokensPrompt + totalTokensCompletion)],
        ]
    ));

    // 检索策略
    if (Object.keys(retrievalStrategies).length > 0) {
        console.log('\n## 检索策略分布\n');
        console.log(formatTable(
            ['策略', '次数'],
            Object.entries(retrievalStrategies).map(([k, v]) => [k, String(v)])
        ));
    }

    // 热门产品
    if (topProducts.length > 0) {
        console.log('\n## 热门产品 (Top 10)\n');
        console.log(formatTable(
            ['产品名', '查询次数'],
            topProducts.map(p => [p.name, String(p.count)])
        ));
    }

    // 错误类型
    if (Object.keys(errorTypes).length > 0) {
        console.log('\n## 错误类型\n');
        console.log(formatTable(
            ['错误类型', '次数'],
            Object.entries(errorTypes).map(([k, v]) => [k, String(v)])
        ));
    }

    console.log('\n' + '='.repeat(60));

    // 保存到文件
    const outputFile = path.join(outputDir, `log_analysis_${date}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
    console.log(`\n📄 分析结果已保存: ${outputFile}`);
}

main().catch(err => {
    console.error('❌ 脚本执行失败:', err);
    process.exit(1);
});
