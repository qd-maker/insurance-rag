/**
 * 健康检查端点
 * 用途：快速诊断 RAG 系统的各个组件
 * 访问：GET /api/health
 */

export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { embedText } from '@/lib/embeddings';

type HealthCheck = { ok: boolean; message: string; details?: Record<string, unknown> };

const CHECK_TIMEOUT_MS = 3000;
const OPENAI_CHECK_TIMEOUT_MS = 5000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

async function withTimeout<T>(
  promise: PromiseLike<T>,
  label: string,
  timeoutMs = CHECK_TIMEOUT_MS
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} 超时`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function GET() {
  const checks: Record<string, HealthCheck> = {};
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

  const hasSupabaseEnv = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const hasOpenAIEnv = Boolean(process.env.OPENAI_API_KEY);

  // Supabase 连接检查
  const supabaseCheck = { ok: false, message: '' };
  if (!hasSupabaseEnv) {
    supabaseCheck.message = 'Supabase 环境变量未配置，跳过连接检查';
  } else {
    try {
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
      );

      const { error } = await withTimeout(
        supabase.from('products').select('id').limit(1),
        'Supabase 连接检查'
      );
      if (error) {
        supabaseCheck.message = `数据库查询失败: ${error.message}`;
      } else {
        supabaseCheck.ok = true;
        supabaseCheck.message = 'Supabase 连接正常';
      }
    } catch (e: unknown) {
      supabaseCheck.message = `Supabase 连接异常: ${errorMessage(e)}`;
    }
  }

  if (!supabaseCheck.ok) overallStatus = 'degraded';
  checks.supabase = supabaseCheck;

  // OpenAI 连接检查（使用多模态 API）
  const openaiCheck = { ok: false, message: '' };
  if (!hasOpenAIEnv) {
    openaiCheck.message = 'OpenAI 环境变量未配置，跳过连接检查';
  } else {
    try {
      const embedding = await withTimeout(
        embedText('健康检查', {
          model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
        }),
        'OpenAI Embedding 检查',
        OPENAI_CHECK_TIMEOUT_MS
      );

      if (embedding && embedding.length > 0) {
        openaiCheck.ok = true;
        openaiCheck.message = `OpenAI 连接正常 (维度: ${embedding.length})`;
      } else {
        openaiCheck.message = 'OpenAI 返回空响应';
      }
    } catch (e: unknown) {
      openaiCheck.message = `OpenAI 连接异常: ${errorMessage(e)}`;
    }
  }

  if (!openaiCheck.ok) overallStatus = 'degraded';
  checks.openai = openaiCheck;

  // 数据库表与索引检查
  const databaseCheck = { ok: false, message: '' };
  if (!hasSupabaseEnv) {
    databaseCheck.message = 'Supabase 环境变量未配置，跳过数据库结构检查';
  } else {
    try {
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
      );

      const [prodResult, clauseResult, rpcResult] = await withTimeout(
        Promise.all([
          supabase.from('products').select('id').limit(1),
          supabase.from('clauses').select('id').limit(1),
          supabase.rpc('match_clauses', {
            query_embedding: new Array(Number(process.env.EMBEDDING_DIM || '1024')).fill(0),
            match_threshold: 0.3,
            match_count: 1,
          }),
        ]),
        '数据库表与 RPC 检查'
      );

      if (prodResult.error || clauseResult.error) {
        databaseCheck.message = '表结构不完整';
      } else if (rpcResult.error) {
        databaseCheck.message = `RPC 函数异常: ${rpcResult.error.message}`;
      } else {
        databaseCheck.ok = true;
        databaseCheck.message = '数据库表与 RPC 函数正常';
      }
    } catch (e: unknown) {
      databaseCheck.message = `数据库检查异常: ${errorMessage(e)}`;
    }
  }

  if (!databaseCheck.ok) overallStatus = 'degraded';
  checks.database = databaseCheck;

  // RAG 流水线检查
  const ragCheck = { ok: false, message: '' };
  if (!hasSupabaseEnv) {
    ragCheck.message = 'Supabase 环境变量未配置，跳过 RAG 检查';
  } else {
    try {
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
      );

      const { data: clauseData, error: clauseErr } = await withTimeout(
        supabase
          .from('clauses')
          .select('id, embedding')
          .not('embedding', 'is', null)
          .limit(1),
        'RAG 条款检查'
      );

      if (clauseErr) {
        ragCheck.message = `无法查询条款: ${clauseErr.message}`;
      } else if (!clauseData || clauseData.length === 0) {
        ragCheck.ok = true;
        ragCheck.message = '数据库为空（正常），请运行 seed 脚本插入数据';
      } else {
        ragCheck.ok = true;
        ragCheck.message = `RAG 流水线正常 (${clauseData.length} 条条款已嵌入)`;
      }
    } catch (e: unknown) {
      ragCheck.message = `RAG 检查异常: ${errorMessage(e)}`;
    }
  }

  if (!ragCheck.ok && ragCheck.message.includes('异常')) {
    overallStatus = 'degraded';
  }

  checks.rag_pipeline = ragCheck;

  // 缓存健康检查
  const cacheCheck: HealthCheck = { ok: false, message: '', details: {} };
  if (!hasSupabaseEnv) {
    cacheCheck.message = 'Supabase 环境变量未配置，跳过缓存检查';
  } else {
    try {
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
      );

      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // 查询缓存统计
      const { data: cacheData, error: cacheErr } = await withTimeout(
        supabase
          .from('search_cache')
          .select('id, hit_count, expires_at, created_at'),
        '缓存健康检查'
      );

      if (cacheErr) {
        cacheCheck.message = `缓存查询失败: ${cacheErr.message}`;
      } else {
        const entries = cacheData || [];
        const expiredCount = entries.filter(e => new Date(e.expires_at) < now).length;
        const activeCount = entries.length - expiredCount;

        // 24小时命中率
        const recent = entries.filter(e => new Date(e.created_at) > yesterday);
        const hits24h = recent.reduce((sum, e) => sum + (e.hit_count || 0), 0);
        const hitRate24h = recent.length > 0
          ? ((hits24h / (hits24h + recent.length)) * 100).toFixed(1)
          : '0.0';

        cacheCheck.ok = true;
        cacheCheck.message = `缓存系统正常 (${activeCount} 活跃, ${expiredCount} 过期)`;
        cacheCheck.details = {
          enabled: process.env.ENABLE_SEARCH_CACHE === 'true',
          hitRate24h: `${hitRate24h}%`,
          activeCount,
          expiredCount,
        };
      }
    } catch (e: unknown) {
      cacheCheck.message = `缓存检查异常: ${errorMessage(e)}`;
    }
  }

  checks.cache = cacheCheck;

  return NextResponse.json(
    {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: overallStatus === 'error' ? 500 : 200 }
  );
}
