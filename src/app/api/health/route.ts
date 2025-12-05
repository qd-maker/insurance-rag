/**
 * 健康检查端点
 * 用途：快速诊断 RAG 系统的各个组件
 * 访问：GET /api/health
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

export async function GET() {
  const checks: Record<string, { ok: boolean; message: string }> = {};
  let overallStatus: 'ok' | 'degraded' | 'error' = 'ok';

  // 环境变量检查
  const envCheck = { ok: true, message: '所有必需的环境变量已配置' };
  const requiredEnvs = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY'];

  for (const env of requiredEnvs) {
    if (!process.env[env]) {
      envCheck.ok = false;
      envCheck.message = `缺少环境变量: ${env}`;
      overallStatus = 'error';
      break;
    }
  }
  checks.environment = envCheck;

  // Supabase 连接检查
  const supabaseCheck = { ok: false, message: '' };
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { error } = await supabase.from('products').select('id').limit(1);
    if (error) {
      supabaseCheck.message = `数据库查询失败: ${error.message}`;
    } else {
      supabaseCheck.ok = true;
      supabaseCheck.message = 'Supabase 连接正常';
    }
  } catch (e: any) {
    supabaseCheck.message = `Supabase 连接异常: ${e?.message}`;
  }

  if (!supabaseCheck.ok) overallStatus = 'degraded';
  checks.supabase = supabaseCheck;

  // OpenAI 连接检查
  const openaiCheck = { ok: false, message: '' };
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await openai.embeddings.create({
      model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      input: '健康检查',
    });

    if (res.data && res.data[0]) {
      openaiCheck.ok = true;
      openaiCheck.message = `OpenAI 连接正常 (维度: ${res.data[0].embedding.length})`;
    } else {
      openaiCheck.message = 'OpenAI 返回空响应';
    }
  } catch (e: any) {
    openaiCheck.message = `OpenAI 连接异常: ${e?.message}`;
  }

  if (!openaiCheck.ok) overallStatus = 'degraded';
  checks.openai = openaiCheck;

  // 数据库表与索引检查
  const databaseCheck = { ok: false, message: '' };
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { error: prodErr } = await supabase.from('products').select('id').limit(1);
    const { error: clauseErr } = await supabase.from('clauses').select('id').limit(1);
    const { error: rpcErr } = await supabase.rpc('match_clauses', {
      query_embedding: new Array(1536).fill(0),
      match_threshold: 0.3,
      match_count: 1,
    });

    if (prodErr || clauseErr) {
      databaseCheck.message = '表结构不完整';
    } else if (rpcErr) {
      databaseCheck.message = `RPC 函数异常: ${rpcErr.message}`;
    } else {
      databaseCheck.ok = true;
      databaseCheck.message = '数据库表与 RPC 函数正常';
    }
  } catch (e: any) {
    databaseCheck.message = `数据库检查异常: ${e?.message}`;
  }

  if (!databaseCheck.ok) overallStatus = 'degraded';
  checks.database = databaseCheck;

  // RAG 流水线检查
  const ragCheck = { ok: false, message: '' };
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data: clauseData, error: clauseErr } = await supabase
      .from('clauses')
      .select('id, embedding')
      .not('embedding', 'is', null)
      .limit(1);

    if (clauseErr) {
      ragCheck.message = `无法查询条款: ${clauseErr.message}`;
    } else if (!clauseData || clauseData.length === 0) {
      ragCheck.ok = true;
      ragCheck.message = '数据库为空（正常），请运行 seed 脚本插入数据';
    } else {
      ragCheck.ok = true;
      ragCheck.message = `RAG 流水线正常 (${clauseData.length} 条条款已嵌入)`;
    }
  } catch (e: any) {
    ragCheck.message = `RAG 检查异常: ${e?.message}`;
  }

  if (!ragCheck.ok && ragCheck.message.includes('异常')) {
    overallStatus = 'degraded';
  }

  checks.rag_pipeline = ragCheck;

  return NextResponse.json(
    {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: overallStatus === 'error' ? 500 : 200 }
  );
}

