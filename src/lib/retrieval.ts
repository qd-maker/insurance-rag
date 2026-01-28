/**
 * 混合检索模块
 * 
 * 负责产品名匹配 + 向量检索 + 优先级过滤的完整检索流程
 * 从 search/route.ts 抽取，便于单元测试和复用
 */

import { embedText } from '@/lib/embeddings';
import { SupabaseClient } from '@supabase/supabase-js';

// ========== 环境变量配置 ==========
const RETRIEVAL_TOP_K = Number(process.env.RETRIEVAL_TOP_K || '10');
const RETRIEVAL_THRESHOLD = Number(process.env.RETRIEVAL_THRESHOLD || '0.3');
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

// ========== 类型定义 ==========

export interface RetrievalOptions {
    matchCount?: number;
    matchThreshold?: number;
    debug?: boolean;
}

export interface ClauseRow {
    id: number;
    product_id: number | null;
    content: string | null;
    similarity?: number;
}

export interface ProductInfo {
    id: number;
    name: string;
}

export type RetrievalStrategy =
    | 'PRODUCT_NAME_MATCH'   // 产品名匹配成功，仅返回该产品条款
    | 'PRODUCT_NAME_RERANK'  // 产品名匹配，但优先级重排序
    | 'VECTOR_ONLY'          // 纯向量检索
    | 'FALLBACK_ILIKE'       // 向量检索失败，使用 ilike 兜底
    | 'NO_RESULTS'           // 无结果
    | 'FAILED';              // 检索失败

export interface RetrievalResult {
    rows: ClauseRow[];
    priorityProductIds: number[];
    matchedProductName: string | null;
    strategy: RetrievalStrategy;
    vectorMatches?: ClauseRow[];      // debug 模式下返回原始向量匹配结果
    allProducts?: ProductInfo[];       // debug 模式下返回所有产品
}

// ========== 工具函数 ==========

/**
 * 产品名归一化（用于缓存键和产品匹配）
 */
export function normalizeProductName(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFKC')
        .replace(/[\s\u3000]/g, '') // 移除空格
        .replace(/[()（）［］【】\[\]·•．・。、，,._/:'""-]+/g, ''); // 移除标点
}

/**
 * 生成缓存键（以产品名为键）
 */
export function getCacheKey(productName: string): string {
    return normalizeProductName(productName);
}

// ========== 核心检索函数 ==========

/**
 * 混合检索：产品名优先匹配 + 向量检索 + 优先级过滤
 * 
 * @param query 用户查询
 * @param supabase Supabase 客户端
 * @param options 检索选项
 * @returns 检索结果，包含条款行、策略、调试信息
 */
export async function hybridRetrieve(
    query: string,
    supabase: SupabaseClient,
    options: RetrievalOptions = {}
): Promise<RetrievalResult> {
    const {
        matchCount = RETRIEVAL_TOP_K,
        matchThreshold = RETRIEVAL_THRESHOLD,
        debug = false
    } = options;

    try {
        // ========== 阶段 1：产品名优先匹配 ==========
        const queryNorm = normalizeProductName(query);
        const { data: allProducts } = await supabase
            .from('products')
            .select('id, name')
            .eq('is_active', true);

        let priorityProductIds: number[] = [];
        let matchedProductName: string | null = null;

        for (const p of allProducts || []) {
            const nameNorm = normalizeProductName(p.name);
            // 双向包含检查：查询包含产品名 或 产品名包含查询
            if (nameNorm.includes(queryNorm) || queryNorm.includes(nameNorm)) {
                priorityProductIds.push(p.id);
                if (!matchedProductName) {
                    matchedProductName = p.name;
                }
            }
        }

        // ========== 阶段 2：向量检索 ==========
        const queryEmbedding = await embedText(query, { model: EMBEDDING_MODEL });

        const { data: matches, error: matchErr } = await supabase.rpc('match_clauses', {
            query_embedding: queryEmbedding,
            match_threshold: matchThreshold,
            match_count: matchCount * 2, // 扩大召回，后续重排
        });

        if (matchErr) {
            console.error('[Retrieval] Vector match error:', matchErr);
            return {
                rows: [],
                priorityProductIds,
                matchedProductName,
                strategy: 'FAILED',
            };
        }

        let rows: ClauseRow[] = Array.isArray(matches) ? matches : [];
        const vectorMatches = debug ? [...rows] : undefined;

        // ========== 阶段 3：优先级过滤 + 重排序 ==========
        let strategy: RetrievalStrategy = 'VECTOR_ONLY';

        if (priorityProductIds.length > 0 && rows.length > 0) {
            // 如果有产品名匹配，只保留该产品的条款
            const priorityRows = rows.filter(
                r => r.product_id && priorityProductIds.includes(r.product_id)
            );

            if (priorityRows.length > 0) {
                rows = priorityRows;
                strategy = 'PRODUCT_NAME_MATCH';
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
                strategy = 'PRODUCT_NAME_RERANK';
            }

            // 截取到原始 matchCount
            rows = rows.slice(0, matchCount);
        }

        // ========== 阶段 4：Fallback - ilike 模糊匹配 ==========
        if (!rows.length) {
            const { data: prodLike, error: prodLikeErr } = await supabase
                .from('products')
                .select('id, name')
                .ilike('name', `%${query}%`)
                .limit(3);

            if (prodLikeErr) {
                console.error('[Retrieval] Fallback ilike error:', prodLikeErr);
                return {
                    rows: [],
                    priorityProductIds,
                    matchedProductName,
                    strategy: 'FAILED',
                };
            }

            const likeIds = (prodLike || []).map((p: any) => p.id);
            if (likeIds.length) {
                const { data: clauseRows, error: clauseErr } = await supabase
                    .from('clauses')
                    .select('id, product_id, content')
                    .in('product_id', likeIds)
                    .limit(matchCount);

                if (clauseErr) {
                    console.error('[Retrieval] Fallback clause fetch error:', clauseErr);
                    return {
                        rows: [],
                        priorityProductIds,
                        matchedProductName,
                        strategy: 'FAILED',
                    };
                }

                rows = clauseRows || [];
                strategy = rows.length > 0 ? 'FALLBACK_ILIKE' : 'NO_RESULTS';
            } else {
                strategy = 'NO_RESULTS';
            }
        }

        // ========== 返回结果 ==========
        const result: RetrievalResult = {
            rows,
            priorityProductIds,
            matchedProductName,
            strategy,
        };

        if (debug) {
            result.vectorMatches = vectorMatches;
            result.allProducts = allProducts || [];
        }

        return result;

    } catch (error: any) {
        console.error('[Retrieval] Unexpected error:', error);
        return {
            rows: [],
            priorityProductIds: [],
            matchedProductName: null,
            strategy: 'FAILED',
        };
    }
}

/**
 * 获取产品名称映射表
 */
export async function getProductNames(
    supabase: SupabaseClient,
    productIds: number[]
): Promise<Record<number, string>> {
    if (productIds.length === 0) return {};

    const { data: prodRows, error: prodErr } = await supabase
        .from('products')
        .select('id, name')
        .in('id', productIds);

    if (prodErr) {
        console.error('[Retrieval] Get product names error:', prodErr);
        return {};
    }

    return (prodRows || []).reduce((acc: Record<number, string>, p: any) => {
        acc[p.id] = p.name;
        return acc;
    }, {});
}

// ========== 导出配置常量（供其他模块使用） ==========
export const RETRIEVAL_CONFIG = {
    topK: RETRIEVAL_TOP_K,
    threshold: RETRIEVAL_THRESHOLD,
    embeddingModel: EMBEDDING_MODEL,
};
