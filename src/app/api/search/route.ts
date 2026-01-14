import { embedText } from '@/lib/embeddings';
import { QueryLogger } from '@/lib/logger';

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

// 条款映射表（用于前端查询引用原文）
type ClauseMap = Record<number, { snippet: string; productName: string | null }>;

// 将检索到的条款整理成可控长度的上下文，避免超长
function buildContext(
  rows: Array<{ id: number; product_id: number | null; content: string | null }>,
  productNames: Record<number, string>
): { context: string; sources: SourceInfo[]; clauseMap: ClauseMap } {
  const parts: string[] = [];
  const sources: SourceInfo[] = [];
  const clauseMap: ClauseMap = {};

  for (const r of rows) {
    const name = r.product_id ? productNames[r.product_id] : null;
    const header = name ? `【产品】${name}  条款ID#${r.id}` : `条款ID#${r.id}`;
    const content = (r.content || '').trim();
    if (!content) continue;
    parts.push(`${header}\n${content}`);
    sources.push({ clauseId: r.id, productName: name });
    // 保存到 clauseMap，截取前 2000 字作为 snippet（保留完整上下文）
    clauseMap[r.id] = {
      snippet: content.length > 2000 ? content.slice(0, 2000) + '...' : content,
      productName: name
    };
  }
  // 控制总长度，避免超过模型上下文限制（粗略按字符裁剪）
  let ctx = parts.join('\n\n---\n\n');
  const MAX_CHARS = 6000; // 约束在一个合理范围内
  if (ctx.length > MAX_CHARS) ctx = ctx.slice(0, MAX_CHARS);
  return { context: ctx, sources, clauseMap };
}

// ========== 精细拒答策略 ==========

// 检测无意义输入
function isGibberish(query: string): { isGibberish: boolean; reason?: string } {
  // 太短
  if (query.length < 2) {
    return { isGibberish: true, reason: '查询内容太短，请输入完整的产品名称或问题' };
  }
  // 纯数字
  if (/^\d+$/.test(query)) {
    return { isGibberish: true, reason: '请输入产品名称而非纯数字' };
  }
  // 纯英文字母且太短（允许如 "RAG" 等缩写）
  if (/^[a-zA-Z]+$/.test(query) && query.length < 3) {
    return { isGibberish: true, reason: '请输入完整的产品名称' };
  }
  // 纯ASCII符号（不包含中文、日文、韩文等 Unicode 字符）
  // 只匹配纯标点符号：!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~ 和空格
  if (/^[\s\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]+$/.test(query)) {
    return { isGibberish: true, reason: '请输入有效的产品名称或问题' };
  }
  // 重复字符（如 "aaaa"）
  if (/^(.)\1{3,}$/.test(query)) {
    return { isGibberish: true, reason: '请输入有效的产品名称或问题' };
  }
  return { isGibberish: false };
}

// ========== 缓存系统 ==========

// 产品名归一化（用于缓存键和产品匹配）
function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\u3000]/g, '') // 移除空格
    .replace(/[()（）［］【】\[\]·•．・。、，,._/:'""-]+/g, ''); // 移除标点
}

// 生成缓存键（简化版：只用产品名）
// ⚠️ 业务场景：用户选择产品 → 生成信息卡片
// 缓存键 = 产品名，不包含query（因为用户不输入问题）
function getCacheKey(productName: string): string {
  return normalizeProductName(productName);
}

// 相似度阈值
const SIMILARITY_THRESHOLD = 0.3;

export async function POST(req: Request) {
  const startTime = Date.now();
  const logger = new QueryLogger();

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

    // ========== 精细拒答：无意义输入检测 ==========
    const gibberishCheck = isGibberish(query);
    if (gibberishCheck.isGibberish) {
      logger.setQuery(query);
      logger.setRefusal(true, gibberishCheck.reason || 'GIBBERISH_INPUT');
      logger.setDuration(Date.now() - startTime);
      logger.save().catch(err => console.error('[Logger] Save failed:', err));

      return NextResponse.json({
        ok: false,
        notFound: { query, reason: 'INVALID_INPUT', message: gibberishCheck.reason }
      });
    }

    // 记录查询
    logger.setQuery(query);
    logger.setTopK(matchCount);

    // ========== 缓存检查：查询 Supabase search_cache 表 ==========
    // ⚠️ 业务逻辑：用户选择产品 → 生成信息卡片
    // 缓存策略：以产品名为键，缓存整个信息卡片
    const ENABLE_CACHE = process.env.ENABLE_SEARCH_CACHE === 'true';
    let cacheKey: string | null = null;
    let cachedResult: { result: any; id: number; hit_count: number } | null = null;

    // ========== 新增：混合检索 - 产品名优先匹配 ==========
    // 0) 优先检查产品名是否直接匹配（只查询启用的产品）
    const queryNorm = normalizeProductName(query);
    const { data: allProducts } = await supabase
      .from('products')
      .select('id, name')
      .eq('is_active', true);  // 只查询启用的产品

    let priorityProductIds: number[] = [];
    let matchedProductName: string | null = null;

    for (const p of allProducts || []) {
      const nameNorm = normalizeProductName(p.name);
      // 双向包含检查：查询包含产品名 或 产品名包含查询
      if (nameNorm.includes(queryNorm) || queryNorm.includes(nameNorm)) {
        priorityProductIds.push(p.id);
        if (!matchedProductName) {
          matchedProductName = p.name; // 记录第一个匹配的产品名
        }
      }
    }

    // ⚠️ 如果检测到产品名，生成缓存键并检查缓存
    if (matchedProductName && ENABLE_CACHE) {
      cacheKey = getCacheKey(matchedProductName);

      try {
        const { data } = await supabase
          .from('search_cache')
          .select('result, id, hit_count')
          .eq('query_hash', cacheKey)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle();

        cachedResult = data;
      } catch (cacheReadErr) {
        console.warn('[Cache] Read failed:', cacheReadErr);
      }

      if (cachedResult?.result) {
        // 缓存命中
        supabase
          .from('search_cache')
          .update({ hit_count: (cachedResult.hit_count || 0) + 1 })
          .eq('id', cachedResult.id);

        logger.setDuration(Date.now() - startTime);
        logger.save().catch(err => console.error('[Logger] Save failed:', err));

        return NextResponse.json({ ...cachedResult.result, _cached: true });
      }
    }
    // ========== 混合检索结束 ==========

    // 1) 生成查询向量 - 使用多模态 API
    const embeddingStart = Date.now();
    const queryEmbedding = await embedText(query, { model: EMBEDDING_MODEL });
    logger.setEmbeddingDuration(Date.now() - embeddingStart);


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

    // 记录检索结果
    logger.setRetrievedChunks(rows);

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

    const { context, sources, clauseMap } = buildContext(rows, productNames);

    // 3) 让模型按固定 JSON 模板抽取结构化信息（带字段级引用）
    // 使用 JSON 模式尽量保证只返回 JSON
    const sysPrompt = `你是一个保险信息抽取助手。请基于"条款上下文"和"用户问题"，提取并汇总该保险产品的关键信息。

**严格要求**：
1. 只能输出纯 JSON（application/json），不要任何多余文本或 Markdown。
2. 每个字段都必须标注来源条款ID（sourceClauseId），如果无法确定来源则填 null。
3. 条款ID格式为"条款ID#数字"，请提取其中的数字作为 sourceClauseId。
4. 严格使用以下结构，绝不编造：

{
  "productName": { "value": string, "sourceClauseId": number | null },
  "overview": { "value": string, "sourceClauseId": number | null },
  "coreCoverage": [{ "title": string, "value": string, "desc": string, "sourceClauseId": number | null }],
  "exclusions": [{ "value": string, "sourceClauseId": number | null }],
  "targetAudience": { "value": string, "sourceClauseId": number | null },
  "salesScript": string[],
  "rawTerms": string
}

**字段说明**：
- coreCoverage: 核心保障责任，title/value/desc 均需简洁明确
- exclusions: 与免责/除外相关的要点
- salesScript: 2-5 条对用户解释/劝服的简短话术（AI生成，无需引用）
- rawTerms: 你引用的原始条款片段（可拼接多条，尽量贴近原文）

**Fallback 规则（极其重要）**：
如果条款上下文中没有明确说明某个字段的信息，你必须：
- 对于 value 字段：填入 "[条款未说明]"（精确使用此标记）
- 对于 sourceClauseId：填入 null
- 绝对禁止编造、推测或使用通用描述

示例：如果条款未提及目标人群，则 targetAudience 应为 { "value": "[条款未说明]", "sourceClauseId": null }`;

    const userPrompt = `用户问题：\n${query}\n\n条款上下文：\n${context}\n\n请输出严格符合上述要求的 JSON。`;

    const debug = Boolean(body?.debug);

    // LLM调用
    const llmStart = Date.now();
    const chat = await openai.chat.completions.create({
      model: GENERATION_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' } as any,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    logger.setLLMDuration(Date.now() - llmStart);

    // 记录token使用
    const promptTokens = chat.usage?.prompt_tokens || 0;
    const completionTokens = chat.usage?.completion_tokens || 0;
    logger.setTokensUsed(promptTokens, completionTokens);

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

    // 添加来源信息和条款映射表
    jsonOut.sources = sources;
    jsonOut.clauseMap = clauseMap;

    // 记录产品名和总耗时（兼容新旧格式）
    const productNameValue = jsonOut.productName?.value || jsonOut.productName || null;
    logger.setProductMatched(productNameValue);
    logger.setRefusal(false, null);
    logger.setDuration(Date.now() - startTime);

    // 保存日志（异步，不阻塞响应）
    logger.save().catch(err => console.error('[Logger] Save failed:', err));

    // ========== 写入缓存：保存到 Supabase search_cache 表 ==========
    // ⚠️ 业务场景：用户选择产品 → 缓存该产品的信息卡片
    // 缓存键 = 产品名（归一化）
    if (ENABLE_CACHE && productNameValue && cacheKey) {
      const cacheExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24小时后过期
      try {
        await supabase
          .from('search_cache')
          .upsert({
            query_hash: cacheKey,
            query_text: productNameValue, // ⚠️ 存储产品名，不是query
            result: jsonOut,
            expires_at: cacheExpiry,
            hit_count: 0
          }, { onConflict: 'query_hash' });
      } catch (cacheErr) {
        console.error('[Cache] Write failed:', cacheErr);
      }
    }

    // 最终只返回结构化对象（不包裹 ok 字段，符合你的要求）
    return NextResponse.json(jsonOut);
  } catch (e: any) {
    // 记录错误并保存日志
    logger.setRefusal(true, e?.message || 'Internal Error');
    logger.setDuration(Date.now() - startTime);
    logger.save().catch(err => console.error('[Logger] Save failed:', err));

    return NextResponse.json({ error: e?.message || 'Internal Error' }, { status: 500 });
  }
}
