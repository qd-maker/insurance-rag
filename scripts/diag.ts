/**
 * RAG 端到端诊断脚本
 * 运行：npx tsx scripts/diag.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM || '1536');
const RAG_MATCH_COUNT = Number(process.env.RAG_MATCH_COUNT || '10');
const RAG_MATCH_THRESHOLD = Number(process.env.RAG_MATCH_THRESHOLD || '0.3');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  ok: (msg: string) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  err: (msg: string) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  warn: (msg: string) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  info: (msg: string) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`),
  section: (msg: string) => console.log(`\n${colors.cyan}━━━ ${msg} ━━━${colors.reset}`),
};

async function checkEnv() {
  log.section('Step 1: 环境变量检查');
  const checks = [
    { name: 'SUPABASE_URL', value: SUPABASE_URL, required: true },
    { name: 'SUPABASE_SERVICE_ROLE_KEY', value: SUPABASE_SERVICE_ROLE_KEY, required: true },
    { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: SUPABASE_ANON_KEY, required: true },
    { name: 'OPENAI_API_KEY', value: OPENAI_API_KEY, required: true },
  ];

  let allOk = true;
  for (const check of checks) {
    if (check.value) {
      const display = check.value.length > 30 ? check.value.slice(0, 20) + '...' : check.value;
      log.ok(`${check.name} = ${display}`);
    } else if (check.required) {
      log.err(`${check.name} 缺失（必填）`);
      allOk = false;
    }
  }

  if (!allOk) throw new Error('环境变量检查失败');
  log.info(`EMBEDDING_DIM=${EMBEDDING_DIM}, EMBEDDING_MODEL=${EMBEDDING_MODEL}`);
}

async function checkSupabaseConnection() {
  log.section('Step 2: Supabase 连接检查');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('缺少 Supabase 配置');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const { data, error } = await supabase.from('products').select('id').limit(1);
    if (error) throw error;
    log.ok('Supabase 连接成功');
    return supabase;
  } catch (e: any) {
    log.err(`Supabase 连接失败: ${e?.message}`);
    throw e;
  }
}

async function checkTableSchema(supabase: any) {
  log.section('Step 3: 表结构检查');
  try {
    const { error: clausesErr } = await supabase.from('clauses').select('id').limit(1);
    if (clausesErr) throw clausesErr;
    log.ok('clauses 表存在');

    const { error: prodErr } = await supabase.from('products').select('id').limit(1);
    if (prodErr) throw prodErr;
    log.ok('products 表存在');
  } catch (e: any) {
    log.err(`表结构检查失败: ${e?.message}`);
    throw e;
  }
}

async function checkEmbeddingDimension(supabase: any) {
  log.section('Step 4: 嵌入维度检查');
  try {
    const { data: existing } = await supabase
      .from('clauses')
      .select('embedding')
      .not('embedding', 'is', null)
      .limit(1);

    if (existing && existing.length > 0 && existing[0].embedding) {
      const actualDim = Array.isArray(existing[0].embedding)
        ? existing[0].embedding.length
        : (existing[0].embedding as any)?.length || 0;

      log.info(`数据库中现有 embedding 维度: ${actualDim}`);
      if (actualDim !== EMBEDDING_DIM) {
        log.warn(`维度不匹配！配置: ${EMBEDDING_DIM}, 实际: ${actualDim}`);
      } else {
        log.ok(`维度一致: ${EMBEDDING_DIM}`);
      }
    } else {
      log.warn('数据库中暂无 embedding 数据');
    }
  } catch (e: any) {
    log.err(`维度检查失败: ${e?.message}`);
  }
}

async function testEmbedding() {
  log.section('Step 5: 嵌入生成测试');
  if (!OPENAI_API_KEY) throw new Error('缺少 OPENAI_API_KEY');

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  try {
    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: 'RAG 诊断测试文本',
    });

    const embedding = res.data[0].embedding;
    const actualDim = embedding.length;
    log.ok(`嵌入生成成功，维度: ${actualDim}`);

    if (actualDim !== EMBEDDING_DIM) {
      log.err(`维度不匹配！配置: ${EMBEDDING_DIM}, 实际: ${actualDim}`);
      throw new Error('嵌入维度配置错误');
    }

    return embedding;
  } catch (e: any) {
    log.err(`嵌入生成失败: ${e?.message}`);
    throw e;
  }
}

async function testInsertAndRetrieve(supabase: any, embedding: number[]) {
  log.section('Step 6: 插入与检索测试');

  try {
    const { data: prodData, error: prodErr } = await supabase
      .from('products')
      .insert({ name: `诊断产品-${Date.now()}`, description: '诊断用' })
      .select('id')
      .single();

    if (prodErr) throw prodErr;
    const productId = prodData.id;
    log.ok(`测试产品已插入，id=${productId}`);

    const { data: clauseData, error: clauseErr } = await supabase
      .from('clauses')
      .insert({
        product_id: productId,
        content: `RAG 诊断测试文档 - ${new Date().toISOString()}`,
        embedding,
      })
      .select('id')
      .single();

    if (clauseErr) throw clauseErr;
    const clauseId = clauseData.id;
    log.ok(`测试条款已插入，id=${clauseId}`);

    const { data: matches, error: matchErr } = await supabase.rpc('match_clauses', {
      query_embedding: embedding,
      match_threshold: 0.1,
      match_count: 5,
    });

    if (matchErr) {
      log.err(`match_clauses RPC 失败: ${matchErr.message}`);
      throw matchErr;
    }

    log.ok(`match_clauses RPC 调用成功，返回 ${matches?.length || 0} 条结果`);

    if (matches && matches.length > 0) {
      const topMatch = matches[0];
      log.ok(`最相似结果: ID=${topMatch.id}, 相似度=${topMatch.similarity?.toFixed(4)}`);
    }

    await supabase.from('clauses').delete().eq('id', clauseId);
    await supabase.from('products').delete().eq('id', productId);
    log.ok('测试数据已清理');

    return matches;
  } catch (e: any) {
    log.err(`插入与检索测试失败: ${e?.message}`);
    throw e;
  }
}

async function checkRLS(supabase: any) {
  log.section('Step 7: RLS 策略检查');
  try {
    const { data: svcData, error: svcErr } = await supabase.from('clauses').select('id').limit(1);
    if (svcErr) {
      log.err(`Service Role 无法读取 clauses: ${svcErr.message}`);
      throw svcErr;
    }
    log.ok('Service Role 可以正常读取 clauses');
  } catch (e: any) {
    log.err(`RLS 检查失败: ${e?.message}`);
  }
}

async function main() {
  console.log(`\n${colors.cyan}╔════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║   RAG 端到端诊断脚本 v1.0            ║${colors.reset}`);
  console.log(`${colors.cyan}╚════════════════════════════════════════╝${colors.reset}\n`);

  try {
    await checkEnv();
    const supabase = await checkSupabaseConnection();
    await checkTableSchema(supabase);
    await checkEmbeddingDimension(supabase);
    const embedding = await testEmbedding();
    const matches = await testInsertAndRetrieve(supabase, embedding);
    await checkRLS(supabase);

    console.log(`\n${colors.cyan}━━━ 诊断完成 ━━━${colors.reset}`);
    if (matches && matches.length > 0) {
      log.ok('✨ 端到端 RAG 链路正常！');
    } else {
      log.warn('⚠️  检索返回空结果，请检查数据或阈值设置');
    }
  } catch (e: any) {
    console.log(`\n${colors.red}━━━ 诊断中断 ━━━${colors.reset}`);
    log.err(`错误: ${e?.message}`);
    process.exit(1);
  }
}

main();

