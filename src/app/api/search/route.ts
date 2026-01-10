import { embedText } from '@/lib/embeddings';

export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// 环境配置
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'; // 1536 维
// 生成模型可按需替换为 gpt-4 或其他模型（需支持 JSON 输出）
const GENERATION_MODEL = process.env.GENERATION_MODEL || 'gpt-4o-mini';

// OpenAI 聚合/直连（仍用于 chat completions）
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: OPENAI_BASE_URL });

// 来源信息类型
type SourceInfo = { clauseId: number; productName: string | null };

// 将检索到的条款整理成可控长度的上下文，避免超长
function buildContext(
  rows: Array<{ id: number; product_id: number | null; content: string | null }>,
  productNames: Record<number, string>
): { context: string; sources: SourceInfo[] } {
  const parts: string[] = [];
  const sources: SourceInfo[] = [];
  for (const r of rows) {
    const name = r.product_id ? productNames[r.product_id] : null;
    const header = name ? `【产品】${name}  条款ID#${r.id}` : `条款ID#${r.id}`;
    const content = (r.content || '').trim();
    if (!content) continue;
    parts.push(`${header}\n${content}`);
    sources.push({ clauseId: r.id, productName: name });
  }
  // 控制总长度，避免超过模型上下文限制（粗略按字符裁剪）
  let ctx = parts.join('\n\n---\n\n');
  const MAX_CHARS = 6000; // 约束在一个合理范围内
  if (ctx.length > MAX_CHARS) ctx = ctx.slice(0, MAX_CHARS);
  return { context: ctx, sources };
}

export async function POST(req: Request) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: '缺少 OPENAI_API_KEY' }, { status: 500 });
    }

    // 使用服务端凭证初始化 Supabase（优先 service role）
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: '缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const query = (body?.query ?? '').toString().trim();
    const matchCount: number = Number(body?.matchCount ?? 10);
    const matchThreshold: number = Number(body?.matchThreshold ?? 0.1);

    if (!query) {
      return NextResponse.json({ error: '缺少必填参数 query' }, { status: 400 });
    }

    // ========== 新增：混合检索 - 产品名优先匹配 ==========
    // 归一化函数（与 products/check 保持一致）
    function normalizeProductName(name: string): string {
      return name
        .toLowerCase()
        .normalize('NFKC')
        .replace(/[\s\u3000]/g, '')
        .replace(/[()（）［］【】\[\]·•．・。、，,._/:'""-]+/g, '');
    }

    // 0) 优先检查产品名是否直接匹配
    const queryNorm = normalizeProductName(query);
    const { data: allProducts } = await supabase
      .from('products')
      .select('id, name');

    let priorityProductIds: number[] = [];
    for (const p of allProducts || []) {
      const nameNorm = normalizeProductName(p.name);
      // 双向包含检查：查询包含产品名 或 产品名包含查询
      if (nameNorm.includes(queryNorm) || queryNorm.includes(nameNorm)) {
        priorityProductIds.push(p.id);
      }
    }
    // ========== 混合检索结束 ==========

    // 1) 生成查询向量 - 使用多模态 API
    const queryEmbedding = await embedText(query, { model: EMBEDDING_MODEL });


    // 2) 调用 Supabase 向量匹配函数
    const { data: matches, error: matchErr } = await supabase.rpc('match_clauses', {
      query_embedding: queryEmbedding,
      match_threshold: matchThreshold,
      match_count: matchCount * 2, // 扩大召回，后续重排
    });
    if (matchErr) throw matchErr;

    let rows: Array<{ id: number; product_id: number | null; content: string | null; similarity?: number }>
      = Array.isArray(matches) ? matches : [];

    // ========== 新增：优先级过滤 + 重排序 ==========
    if (priorityProductIds.length > 0 && rows.length > 0) {
      // 🔥 关键修改：如果有产品名匹配，只保留该产品的条款
      const priorityRows = rows.filter(r => r.product_id && priorityProductIds.includes(r.product_id));

      if (priorityRows.length > 0) {
        // 如果优先产品有足够条款，只使用这些条款
        rows = priorityRows;
        console.log(`[混合检索] 产品名匹配成功，过滤为仅包含匹配产品的 ${rows.length} 条条款`);
      } else {
        // 否则保留所有结果并重排序
        rows.sort((a, b) => {
          const aMatch = a.product_id && priorityProductIds.includes(a.product_id);
          const bMatch = b.product_id && priorityProductIds.includes(b.product_id);
          if (aMatch && !bMatch) return -1;
          if (!aMatch && bMatch) return 1;
          return (b.similarity || 0) - (a.similarity || 0);
        });
      }

      // 截取到原始 matchCount
      rows = rows.slice(0, matchCount);
    }
    // ========== 过滤 + 重排序结束 ==========

    let usedFallback = false;

    // Fallback：若相似检索无结果，尝试按产品名模糊匹配，直接抓取条款
    if (!rows.length) {
      const { data: prodLike, error: prodLikeErr } = await supabase
        .from('products')
        .select('id, name')
        .ilike('name', `%${query}%`)
        .limit(3);
      if (prodLikeErr) throw prodLikeErr;
      const likeIds = (prodLike || []).map((p: any) => p.id);
      if (likeIds.length) {
        usedFallback = true;
        const { data: clauseRows, error: clauseErr } = await supabase
          .from('clauses')
          .select('id, product_id, content')
          .in('product_id', likeIds)
          .limit(matchCount);
        if (clauseErr) throw clauseErr;
        rows = clauseRows || [];
      }
    }

    // 若仍无匹配，直接返回 notFound 兜底，避免无上下文调用模型
    if (!rows.length) {
      return NextResponse.json({
        ok: true,
        retrieval: [],
        notFound: { query, reason: 'NO_SIMILAR_PRODUCT' },
      });
    }

    // 拉取产品名，增强上下文可读性
    const productIds = Array.from(new Set(rows.map(r => r.product_id).filter(Boolean))) as number[];
    let productNames: Record<number, string> = {};
    if (productIds.length) {
      const { data: prodRows, error: prodErr } = await supabase
        .from('products')
        .select('id, name')
        .in('id', productIds);
      if (prodErr) throw prodErr;
      productNames = (prodRows || []).reduce((acc: Record<number, string>, p: any) => {
        acc[p.id] = p.name;
        return acc;
      }, {});
    }

    const { context, sources } = buildContext(rows, productNames);

    // 3) 让模型按固定 JSON 模板抽取结构化信息
    // 使用 JSON 模式尽量保证只返回 JSON
    const sysPrompt = `你是一个保险信息抽取助手。请基于“条款上下文”和“用户问题”，提取并汇总该保险产品的关键信息。严格要求：\n- 只能输出纯 JSON（application/json），不要任何多余文本或 Markdown。\n- 严格使用以下字段，缺失则给空字符串或空数组，绝不编造：\n{\n  'productName': string,\n  'overview': string,\n  'coreCoverage': Array<{ title: string, value: string, desc: string }>,\n  'exclusions': string[],\n  'targetAudience': string,\n  'salesScript': string[],\n  'rawTerms': string\n}\n- coreCoverage 中 title/value/desc 均需简洁明确；\n- exclusions 列出与免责/除外相关的要点；\n- salesScript 给出 2-5 条对用户解释/劝服的简短话术；\n- rawTerms 填写你引用的原始条款片段（可拼接多条，尽量贴近原文）。\n- 如果上下文没有相关信息，请留空，不要臆造。`;

    const userPrompt = `用户问题：\n${query}\n\n条款上下文：\n${context}\n\n请输出严格符合上述要求的 JSON。`;

    const debug = Boolean(body?.debug);

    const chat = await openai.chat.completions.create({
      model: GENERATION_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' } as any,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const text = chat.choices?.[0]?.message?.content?.trim() || '';

    // 兜底：如果不是 JSON，尝试修正为 JSON
    let jsonOut: any;
    try {
      jsonOut = JSON.parse(text);
    } catch {
      // 简单包裹兜底，确保返回结构
      jsonOut = {
        productName: '',
        overview: '',
        coreCoverage: [],
        exclusions: [],
        targetAudience: '',
        salesScript: [],
        rawTerms: context || '',
        sources: sources || [],
        _raw: text, // 便于排查（可在生产中移除）
      };
    }

    // 调试字段（仅当 debug=true 时返回）
    if (debug) {
      try {
        (jsonOut as any)._debugUsedFallback = usedFallback;
        (jsonOut as any)._debugContext = context;
        (jsonOut as any)._debugMatches = rows?.slice?.(0, 20) ?? [];
      } catch { }
    }

    // 添加来源信息
    jsonOut.sources = sources;

    // 最终只返回结构化对象（不包裹 ok 字段，符合你的要求）
    return NextResponse.json(jsonOut);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal Error' }, { status: 500 });
  }
}
