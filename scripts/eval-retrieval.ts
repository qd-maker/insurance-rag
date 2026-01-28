/**
 * 检索质量评估脚本
 * 
 * 读取 data/eval_set.csv 中的测试数据，评估检索质量
 * 指标：产品命中率、Top-K 召回覆盖率、跨产品污染率
 * 
 * 用法：npx tsx scripts/eval-retrieval.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// 加载环境变量
config({ path: '.env.local' });
config({ path: '.env' });

// ========== 配置 ==========
const EVAL_SET_PATH = path.join(process.cwd(), 'data', 'eval_set.csv');
const OUTPUT_DIR = path.join(process.cwd(), 'outputs');

// ========== 类型定义 ==========
interface EvalCase {
    id: number;
    product_name: string;
    test_type: string;
    notes: string;
}

interface RetrievalResult {
    rows: Array<{
        id: number;
        product_id: number | null;
        content: string | null;
        similarity?: number;
    }>;
    priorityProductIds: number[];
    matchedProductName: string | null;
    strategy: string;
}

interface EvalMetrics {
    totalCases: number;
    productHitRate: number;      // 产品命中率：检索结果中包含目标产品的比例
    topKRecall: number;          // Top-K 召回覆盖率：目标产品条款占检索结果的比例
    contaminationRate: number;   // 跨产品污染率：检索结果中非目标产品的比例
    avgRetrievalTime: number;    // 平均检索时间
    details: Array<{
        query: string;
        expectedProduct: string;
        matchedProduct: string | null;
        strategy: string;
        hit: boolean;
        topKRecall: number;
        contamination: number;
        retrievalTime: number;
    }>;
}

// ========== 工具函数 ==========

function parseCSV(content: string): EvalCase[] {
    const lines = content.trim().split('\n');
    const header = lines[0].split(',');

    return lines.slice(1).filter(line => line.trim()).map(line => {
        const values = line.split(',');
        return {
            id: parseInt(values[0], 10),
            product_name: values[1],
            test_type: values[2],
            notes: values[3] || '',
        };
    });
}

function normalizeProductName(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFKC')
        .replace(/[\s\u3000]/g, '')
        .replace(/[()（）［］【】\[\]·•．・。、，,._/:'""-]+/g, '');
}

// ========== 主函数 ==========

async function main() {
    console.log('🔍 检索质量评估脚本启动...\n');

    // 检查环境变量
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error('❌ 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    if (!OPENAI_API_KEY) {
        console.error('❌ 缺少 OPENAI_API_KEY（用于生成 embedding）');
        process.exit(1);
    }

    // 读取测试数据
    if (!fs.existsSync(EVAL_SET_PATH)) {
        console.error(`❌ 测试数据文件不存在: ${EVAL_SET_PATH}`);
        process.exit(1);
    }

    const csvContent = fs.readFileSync(EVAL_SET_PATH, 'utf-8');
    const evalCases = parseCSV(csvContent);
    console.log(`📊 加载 ${evalCases.length} 条测试用例\n`);

    // 初始化 Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 获取所有产品（用于验证）
    const { data: allProducts } = await supabase
        .from('products')
        .select('id, name')
        .eq('is_active', true);

    const productMap = new Map<string, number>();
    for (const p of allProducts || []) {
        productMap.set(normalizeProductName(p.name), p.id);
    }

    console.log(`📦 数据库中有 ${allProducts?.length || 0} 个活跃产品\n`);

    // 动态导入 hybridRetrieve（避免顶层 await 问题）
    const { hybridRetrieve } = await import('../src/lib/retrieval');

    // 执行评估
    const metrics: EvalMetrics = {
        totalCases: evalCases.length,
        productHitRate: 0,
        topKRecall: 0,
        contaminationRate: 0,
        avgRetrievalTime: 0,
        details: [],
    };

    let totalHits = 0;
    let totalRecall = 0;
    let totalContamination = 0;
    let totalTime = 0;

    for (const evalCase of evalCases) {
        const query = evalCase.product_name;
        const expectedProductNorm = normalizeProductName(query);
        const expectedProductId = productMap.get(expectedProductNorm);

        console.log(`🔄 测试: "${query}" (ID: ${evalCase.id}, 类型: ${evalCase.test_type})`);

        const startTime = Date.now();

        try {
            const result: RetrievalResult = await hybridRetrieve(query, supabase, {
                matchCount: 10,
                matchThreshold: 0.3,
                debug: false,
            });

            const retrievalTime = Date.now() - startTime;
            totalTime += retrievalTime;

            // 计算指标
            const { rows, matchedProductName, strategy } = result;

            // 产品命中：检索结果中是否包含目标产品的条款
            const hit = rows.some(r => r.product_id === expectedProductId);
            if (hit) totalHits++;

            // Top-K 召回：目标产品条款占检索结果的比例
            const targetProductRows = rows.filter(r => r.product_id === expectedProductId);
            const recall = rows.length > 0 ? targetProductRows.length / rows.length : 0;
            totalRecall += recall;

            // 污染率：非目标产品的条款比例
            const contaminatedRows = rows.filter(r => r.product_id !== expectedProductId && r.product_id !== null);
            const contamination = rows.length > 0 ? contaminatedRows.length / rows.length : 0;
            totalContamination += contamination;

            const detail = {
                query,
                expectedProduct: evalCase.product_name,
                matchedProduct: matchedProductName,
                strategy,
                hit,
                topKRecall: recall,
                contamination,
                retrievalTime,
            };

            metrics.details.push(detail);

            const hitIcon = hit ? '✅' : '❌';
            console.log(`   ${hitIcon} 命中: ${hit}, 策略: ${strategy}, 召回: ${(recall * 100).toFixed(1)}%, 污染: ${(contamination * 100).toFixed(1)}%, 耗时: ${retrievalTime}ms`);

        } catch (error: any) {
            console.log(`   ❌ 错误: ${error.message}`);
            metrics.details.push({
                query,
                expectedProduct: evalCase.product_name,
                matchedProduct: null,
                strategy: 'ERROR',
                hit: false,
                topKRecall: 0,
                contamination: 1,
                retrievalTime: Date.now() - startTime,
            });
        }
    }

    // 计算汇总指标
    metrics.productHitRate = totalHits / evalCases.length;
    metrics.topKRecall = totalRecall / evalCases.length;
    metrics.contaminationRate = totalContamination / evalCases.length;
    metrics.avgRetrievalTime = totalTime / evalCases.length;

    // 输出结果
    console.log('\n' + '='.repeat(60));
    console.log('📈 评估结果汇总');
    console.log('='.repeat(60));
    console.log(`总测试用例: ${metrics.totalCases}`);
    console.log(`产品命中率: ${(metrics.productHitRate * 100).toFixed(1)}% ${metrics.productHitRate >= 0.95 ? '✅' : '⚠️'}`);
    console.log(`Top-K 召回率: ${(metrics.topKRecall * 100).toFixed(1)}%`);
    console.log(`跨产品污染率: ${(metrics.contaminationRate * 100).toFixed(1)}% ${metrics.contaminationRate <= 0.1 ? '✅' : '⚠️'}`);
    console.log(`平均检索时间: ${metrics.avgRetrievalTime.toFixed(0)}ms`);
    console.log('='.repeat(60));

    // 验收判断
    const passed = metrics.productHitRate >= 0.95;
    if (passed) {
        console.log('\n✅ 验收通过：产品命中率 ≥ 95%');
    } else {
        console.log('\n❌ 验收未通过：产品命中率 < 95%');
    }

    // 保存详细结果
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const outputPath = path.join(OUTPUT_DIR, `eval_retrieval_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(metrics, null, 2));
    console.log(`\n📄 详细结果已保存: ${outputPath}`);

    // 退出码
    process.exit(passed ? 0 : 1);
}

main().catch(err => {
    console.error('❌ 脚本执行失败:', err);
    process.exit(1);
});
