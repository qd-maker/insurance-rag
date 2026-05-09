/**
 * RAGAS-style 评估脚本
 * 
 * 用法：
 *   npm run eval:ragas
 *   npm run eval:ragas -- --config hyde_rerank
 * 
 * 输出：评估报告 + JSON 结果文件
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { RAGPipeline } from '../src/lib/rag/pipeline';
import { RAGEvaluator, generateEvalReport } from '../src/lib/rag/evaluation';
import { DEFAULT_PIPELINE_CONFIG, PipelineConfig } from '../src/lib/rag/types';
import * as fs from 'fs';
import * as path from 'path';

// ========== 预定义的 Pipeline 配置（用于 A/B 对比） ==========

const PIPELINE_CONFIGS: Record<string, Partial<PipelineConfig>> = {
  baseline: {
    enableHyDE: false,
    enableRerank: false,
    enableBM25: false,
    // 最基础：只有 Dense 向量检索
  },
  hyde_only: {
    enableHyDE: true,
    enableRerank: false,
    enableBM25: false,
  },
  hybrid_only: {
    enableHyDE: false,
    enableRerank: false,
    enableBM25: true,
  },
  hyde_rerank: {
    enableHyDE: true,
    enableRerank: true,
    enableBM25: true,
    // 完整 pipeline
  },
  aggressive_rerank: {
    enableHyDE: true,
    enableRerank: true,
    enableBM25: true,
    retrievalTopK: 30,
    rerankTopK: 3,
  },
};

// ========== 评估数据集 ==========

interface EvalCase {
  query: string;
  expectedProduct?: string;
  groundTruth?: string;
}

const EVAL_DATASET: EvalCase[] = [
  {
    query: '安心无忧医疗险',
    expectedProduct: '安心无忧医疗险',
    groundTruth: '医疗保险产品，涵盖住院、门诊等医疗保障',
  },
  {
    query: '康宁保重疾险',
    expectedProduct: '康宁保重疾险',
    groundTruth: '重大疾病保险，覆盖多种重大疾病保障',
  },
  {
    query: '惠民安心守护重大疾病险（旗舰版）',
    expectedProduct: '惠民安心守护重大疾病险（旗舰版）',
  },
  {
    query: '乐享年金险',
    expectedProduct: '乐享年金险',
  },
  // 边界测试
  {
    query: '安心无忧',
    expectedProduct: '安心无忧医疗险',
  },
  {
    query: '这个险种免赔额是多少',
  },
];

// ========== 主函数 ==========

async function main() {
  const configName = process.argv.find(a => a.startsWith('--config='))?.split('=')[1] || 'hyde_rerank';

  console.log(`\n🚀 RAGAS Evaluation - Config: ${configName}\n`);

  // 初始化
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const pipelineConfig = PIPELINE_CONFIGS[configName] || {};
  const pipeline = new RAGPipeline({ ...DEFAULT_PIPELINE_CONFIG, ...pipelineConfig, streaming: false });
  const evaluator = new RAGEvaluator();

  // 运行评估
  const results: any[] = [];

  for (const evalCase of EVAL_DATASET) {
    console.log(`  📝 Evaluating: "${evalCase.query}"...`);

    try {
      // 执行 Pipeline
      const { result, trace } = await pipeline.execute(evalCase.query, supabase);

      // 准备评估输入
      const contexts = trace.steps
        .filter(s => s.type === 'retrieval')
        .flatMap(s => s.output?.chunks || [])
        .map((c: any) => c.content || c.chunk?.content || '')
        .filter(Boolean);

      // 执行 RAGAS 评估
      const evalResult = await evaluator.evaluate({
        query: evalCase.query,
        answer: result.content,
        contexts: contexts.length > 0 ? contexts : ['[no context retrieved]'],
        groundTruth: evalCase.groundTruth,
      });

      results.push({
        query: evalCase.query,
        metrics: evalResult.metrics,
        latencyMs: result.latencyMs,
        tokensUsed: result.tokensUsed,
        traceId: trace.traceId,
      });

      console.log(`    ✅ Overall: ${(evalResult.metrics.overall * 100).toFixed(1)}% | Latency: ${result.latencyMs}ms`);
    } catch (error: any) {
      console.error(`    ❌ Error: ${error.message}`);
      results.push({
        query: evalCase.query,
        error: error.message,
      });
    }
  }

  // 计算聚合指标
  const validResults = results.filter(r => r.metrics);
  const aggregate = {
    faithfulness: avg(validResults.map(r => r.metrics.faithfulness)),
    answerRelevancy: avg(validResults.map(r => r.metrics.answerRelevancy)),
    contextPrecision: avg(validResults.map(r => r.metrics.contextPrecision)),
    contextRecall: avg(validResults.map(r => r.metrics.contextRecall)),
    citationAccuracy: avg(validResults.map(r => r.metrics.citationAccuracy)),
    overall: avg(validResults.map(r => r.metrics.overall)),
  };

  // 输出报告
  const report = generateEvalReport(aggregate, configName);
  console.log(report);

  // 保存结果
  const outputDir = path.join(process.cwd(), 'outputs', 'eval');
  fs.mkdirSync(outputDir, { recursive: true });

  const outputFile = path.join(outputDir, `ragas_${configName}_${Date.now()}.json`);
  fs.writeFileSync(outputFile, JSON.stringify({
    config: configName,
    pipelineConfig,
    aggregate,
    results,
    timestamp: new Date().toISOString(),
  }, null, 2));

  console.log(`\n📄 Results saved to: ${outputFile}\n`);
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

main().catch(console.error);
