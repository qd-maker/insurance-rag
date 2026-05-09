/**
 * Pipeline A/B 对比评估脚本
 * 
 * 对比不同 pipeline 配置的效果，生成对比报告
 * 
 * 用法：
 *   npm run eval:compare
 *   npm run eval:compare -- --configs baseline,hyde_rerank
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { RAGPipeline } from '../src/lib/rag/pipeline';
import { DEFAULT_PIPELINE_CONFIG, PipelineConfig } from '../src/lib/rag/types';
import * as fs from 'fs';
import * as path from 'path';

// 配置集
const CONFIGS: Record<string, Partial<PipelineConfig>> = {
  'v1_baseline': {
    enableHyDE: false,
    enableRerank: false,
    enableBM25: false,
  },
  'v2_hyde': {
    enableHyDE: true,
    enableRerank: false,
    enableBM25: false,
  },
  'v2_hybrid': {
    enableHyDE: false,
    enableRerank: false,
    enableBM25: true,
  },
  'v2_full': {
    enableHyDE: true,
    enableRerank: true,
    enableBM25: true,
  },
};

const TEST_QUERIES = [
  '安心无忧医疗险',
  '康宁保重疾险',
  '惠民安心守护重大疾病险（旗舰版）',
  '乐享年金险',
  '安心无忧', // 简称测试
];

async function main() {
  const configsArg = process.argv.find(a => a.startsWith('--configs='))?.split('=')[1];
  const configNames = configsArg ? configsArg.split(',') : Object.keys(CONFIGS);

  console.log(`\n🔬 Pipeline A/B Comparison\n`);
  console.log(`Configs: ${configNames.join(', ')}`);
  console.log(`Queries: ${TEST_QUERIES.length}\n`);

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing env vars');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 收集结果
  const allResults: Record<string, { latencies: number[]; tokens: number[]; errors: number }> = {};

  for (const configName of configNames) {
    const config = CONFIGS[configName];
    if (!config) {
      console.warn(`⚠️ Unknown config: ${configName}`);
      continue;
    }

    console.log(`\n━━━ Config: ${configName} ━━━`);
    const pipeline = new RAGPipeline({ ...DEFAULT_PIPELINE_CONFIG, ...config, streaming: false });

    allResults[configName] = { latencies: [], tokens: [], errors: 0 };

    for (const query of TEST_QUERIES) {
      try {
        const start = Date.now();
        const { result, trace } = await pipeline.execute(query, supabase);
        const latency = Date.now() - start;

        allResults[configName].latencies.push(latency);
        allResults[configName].tokens.push(result.tokensUsed.prompt + result.tokensUsed.completion);

        const stepsInfo = trace.steps.map(s => `${s.name}(${s.endTime - s.startTime}ms)`).join(' → ');
        console.log(`  ✅ "${query}" | ${latency}ms | Steps: ${stepsInfo}`);
      } catch (error: any) {
        allResults[configName].errors++;
        console.log(`  ❌ "${query}" | Error: ${error.message}`);
      }
    }
  }

  // 生成对比表
  console.log('\n\n📊 ═══════ COMPARISON RESULTS ═══════\n');
  console.log('| Config | Avg Latency | P95 Latency | Avg Tokens | Errors |');
  console.log('|--------|-------------|-------------|------------|--------|');

  for (const [name, data] of Object.entries(allResults)) {
    const avgLat = avg(data.latencies);
    const p95Lat = percentile(data.latencies, 95);
    const avgTok = avg(data.tokens);
    console.log(`| ${name.padEnd(15)} | ${avgLat.toFixed(0).padStart(8)}ms | ${p95Lat.toFixed(0).padStart(8)}ms | ${avgTok.toFixed(0).padStart(8)} | ${data.errors.toString().padStart(4)} |`);
  }

  // 保存结果
  const outputDir = path.join(process.cwd(), 'outputs', 'eval');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `compare_${Date.now()}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(allResults, null, 2));
  console.log(`\n📄 Saved: ${outputFile}\n`);
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
}

function percentile(nums: number[], p: number): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

main().catch(console.error);
