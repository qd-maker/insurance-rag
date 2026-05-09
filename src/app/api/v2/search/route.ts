/**
 * V2 Search API - Advanced RAG Pipeline
 * 
 * 改进点：
 * 1. 支持 SSE 流式响应
 * 2. 完整 RAG Pipeline（HyDE + Hybrid + Rerank）
 * 3. 全链路 Tracing
 * 4. Pipeline 配置可选（支持 A/B 对比）
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { RAGPipeline } from '@/lib/rag/pipeline';
import { DEFAULT_PIPELINE_CONFIG } from '@/lib/rag/types';

export const runtime = 'nodejs';

// ========== 请求参数 ==========
interface SearchRequest {
  query: string;
  streaming?: boolean;
  config?: Partial<typeof DEFAULT_PIPELINE_CONFIG>;
  debug?: boolean;
}

type JsonObject = Record<string, unknown>;

interface CacheRow {
  id: number;
  hit_count: number | null;
  result: JsonObject;
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // 验证环境变量
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const OPENAI_KEY = process.env.OPENAI_API_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY) {
      return NextResponse.json(
        { error: 'Missing required environment variables' },
        { status: 500 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 解析请求
    const body = await req.json() as Partial<SearchRequest>;
    const { query, streaming = false, config = {}, debug = false } = body;

    if (typeof query !== 'string' || query.trim().length < 2) {
      return NextResponse.json(
        { error: 'Query too short', message: '请输入至少 2 个字符' },
        { status: 400 }
      );
    }

    const normalizedQuery = query.trim();
    if (normalizedQuery.length > 500) {
      return NextResponse.json(
        { error: 'Query too long', message: '请输入 500 字以内的问题' },
        { status: 400 }
      );
    }

    // 创建 Pipeline 实例（支持自定义配置用于 A/B 测试）
    const pipeline = new RAGPipeline({
      ...DEFAULT_PIPELINE_CONFIG,
      ...config,
      streaming,
    });

    // ========== 缓存检查 ==========
    const ENABLE_CACHE = process.env.ENABLE_SEARCH_CACHE === 'true';
    if (ENABLE_CACHE) {
      const cacheResult = await checkCache(normalizedQuery, supabase);
      if (cacheResult) {
        return NextResponse.json({
          ...cacheResult,
          _cached: true,
          _latencyMs: Date.now() - startTime,
        });
      }
    }

    // ========== 流式响应 ==========
    if (streaming) {
      const { stream, trace } = await pipeline.executeStream(normalizedQuery, supabase);

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Trace-Id': trace.traceId,
        },
      });
    }

    // ========== 非流式响应 ==========
    const { result, trace } = await pipeline.execute(normalizedQuery, supabase);

    // 写入缓存
    if (ENABLE_CACHE && result.content && !result.content.error && isCacheableResult(result.content as JsonObject)) {
      await writeCache(normalizedQuery, result.content as JsonObject, supabase).catch(err =>
        console.error('[Cache] Write failed:', err)
      );
    }

    // 构建响应
    const response: JsonObject = {
      ...result.content,
      _pipeline: {
        model: result.model,
        tokensUsed: result.tokensUsed,
        latencyMs: result.latencyMs,
        totalLatencyMs: Date.now() - startTime,
      },
    };

    // Debug 模式返回 trace
    if (debug) {
      response._trace = trace;
    }

    return NextResponse.json(response, {
      headers: { 'X-Trace-Id': trace.traceId },
    });

  } catch (error: unknown) {
    console.error('[V2 Search] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// ========== 缓存辅助函数 ==========

async function checkCache(query: string, supabase: SupabaseClient): Promise<JsonObject | null> {
  const normalizedQuery = query.toLowerCase().normalize('NFKC').replace(/\s+/g, '');
  const cacheKey = `v2:${normalizedQuery}`;

  try {
    const { data } = await supabase
      .from('search_cache')
      .select('result, id, hit_count')
      .eq('query_hash', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    const row = data as CacheRow | null;
    if (row?.result && isUsableCachedResult(row.result)) {
      // 更新命中计数
      await supabase.from('search_cache')
        .update({ hit_count: (row.hit_count || 0) + 1 })
        .eq('id', row.id);
      return row.result;
    }
  } catch (err) {
    console.warn('[Cache] Read error:', err);
  }

  return null;
}

function isUsableCachedResult(result: JsonObject): boolean {
  if (result.error) return false;
  const sources = result.sources;
  if (Array.isArray(sources) && sources.length > 0) return true;
  const clauseMap = result.clauseMap;
  if (clauseMap && typeof clauseMap === 'object' && Object.keys(clauseMap).length > 0) return true;
  return false;
}

function isCacheableResult(result: JsonObject): boolean {
  return isUsableCachedResult(result);
}

async function writeCache(query: string, result: JsonObject, supabase: SupabaseClient) {
  const normalizedQuery = query.toLowerCase().normalize('NFKC').replace(/\s+/g, '');
  const cacheKey = `v2:${normalizedQuery}`;
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await supabase.from('search_cache').upsert({
    query_hash: cacheKey,
    query_text: query,
    result,
    expires_at: expiry,
    hit_count: 0,
  }, { onConflict: 'query_hash' });
}
