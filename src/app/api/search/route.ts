import { QueryLogger, logError } from '@/lib/logger';
import { SearchRequestSchema, SearchSuccessResponseSchema, parseAndValidate } from '@/lib/schemas';
import { hybridRetrieve, getProductNames, getCacheKey, ClauseRow } from '@/lib/retrieval';

export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// 环境配置
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
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
// getCacheKey 已从 @/lib/retrieval 导入

export async function POST(req: Request) {
  const startTime = Date.now();
  const logger = new QueryLogger();
  const requestId = logger.requestId;

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

    // ========== Schema 校验 ==========
    const parsed = await parseAndValidate(req, SearchRequestSchema);
    if (!parsed.success) {
      return parsed.response;
    }
    const { query, matchCount, matchThreshold, debug } = parsed.data;

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

    // ========== 缓存检查 ==========
    const ENABLE_CACHE = process.env.ENABLE_SEARCH_CACHE === 'true';
    let cacheKey: string | null = null;
    let cachedResult: { result: any; id: number; hit_count: number } | null = null;

    // ========== 调用混合检索模块 ==========
    const retrievalResult = await hybridRetrieve(query, supabase, {
      matchCount,
      matchThreshold,
      debug,
    });

    const { rows, matchedProductName, strategy } = retrievalResult;
    const usedFallback = strategy === 'FALLBACK_ILIKE';

    // 记录检索结果和策略
    logger.setRetrievedChunks(rows);
    logger.setRetrievalStrategy(strategy);

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
        logger.setCacheHit(true);
        supabase
          .from('search_cache')
          .update({ hit_count: (cachedResult.hit_count || 0) + 1 })
          .eq('id', cachedResult.id);

        logger.setDuration(Date.now() - startTime);
        logger.save().catch(err => console.error('[Logger] Save failed:', err));

        return NextResponse.json(
          { ...cachedResult.result, _cached: true },
          { headers: { 'X-Request-Id': requestId } }
        );
      }
    }

    // 若无匹配，直接返回 notFound 兜底
    if (!rows.length || strategy === 'NO_RESULTS' || strategy === 'FAILED') {
      logger.setDuration(Date.now() - startTime);
      logger.save().catch(err => console.error('[Logger] Save failed:', err));

      return NextResponse.json(
        { ok: true, retrieval: [], notFound: { query, reason: 'NO_SIMILAR_PRODUCT' } },
        { headers: { 'X-Request-Id': requestId } }
      );
    }

    // 拉取产品名
    const productIds = Array.from(new Set(rows.map(r => r.product_id).filter(Boolean))) as number[];
    const productNames = await getProductNames(supabase, productIds)

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

    // ========== Schema 校验 LLM 输出 ==========
    const schemaValidation = SearchSuccessResponseSchema.safeParse(jsonOut);
    if (!schemaValidation.success) {
      console.error('[Schema] LLM output validation failed:', schemaValidation.error.issues);
      logger.setRefusal(true, 'SCHEMA_VIOLATION');
      logger.setDuration(Date.now() - startTime);
      logger.save().catch(err => console.error('[Logger] Save failed:', err));

      return NextResponse.json({
        error: 'SCHEMA_VIOLATION',
        message: 'LLM 输出结构校验失败',
        details: schemaValidation.error.issues,
        raw: jsonOut,
      }, { status: 500 });
    }

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
    return NextResponse.json(jsonOut, {
      headers: { 'X-Request-Id': requestId }
    });
  } catch (e: any) {
    // 记录错误并保存日志
    const errorMessage = e?.message || 'Internal Error';
    logger.setError('INTERNAL_ERROR', errorMessage);
    logger.setRefusal(true, errorMessage);
    logger.setDuration(Date.now() - startTime);
    logger.save().catch(err => console.error('[Logger] Save failed:', err));

    // 写入错误日志
    logError(requestId, 'INTERNAL_ERROR', errorMessage, e?.stack, {
      query: logger.getLog().query,
    }).catch(err => console.error('[Logger] Error log failed:', err));

    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: { 'X-Request-Id': requestId } }
    );
  }
}
