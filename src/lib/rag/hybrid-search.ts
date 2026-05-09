/**
 * Hybrid Search - BM25 + Dense Vector + RRF 融合
 * 
 * 核心思想：
 * - Dense (向量) 检索擅长语义相似性，能找到同义词和释义
 * - Sparse (BM25) 检索擅长精确关键词匹配，对专业术语敏感
 * - RRF (Reciprocal Rank Fusion) 融合两者排名，取长补短
 * 
 * 实现：
 * - Dense: pgvector cosine similarity
 * - Sparse: PostgreSQL ts_rank + to_tsvector (中文分词用 zhparser 或 jieba)
 *   备选: 应用层 BM25 (对小数据集足够)
 * - Fusion: RRF with configurable k parameter
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { ScoredChunk, Chunk, ChunkMetadata, RAGStep } from './types';

export interface HybridSearchConfig {
  denseWeight: number;    // Dense 分数权重 (0-1)
  sparseWeight: number;   // Sparse 分数权重 (0-1)
  rrfK: number;           // RRF 参数 k (通常 60)
  denseTopK: number;      // Dense 检索数量
  sparseTopK: number;     // Sparse 检索数量
  fusionMethod: 'rrf' | 'weighted_sum' | 'convex_combination';
  matchThreshold: number; // 最低相似度阈值
}

const DEFAULT_CONFIG: HybridSearchConfig = {
  denseWeight: 0.6,
  sparseWeight: 0.4,
  rrfK: 60,
  denseTopK: 20,
  sparseTopK: 20,
  fusionMethod: 'rrf',
  matchThreshold: 0.3,
};

const SEARCH_TIMEOUT_MS = 5000;

async function withTimeout<T>(
  promise: PromiseLike<T>,
  label: string,
  timeoutMs = SEARCH_TIMEOUT_MS
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(label + ' 超时')), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

interface RawDenseResult {
  id: number;
  product_id: number;
  content: string;
  similarity: number;
}

interface RawSparseResult {
  id: number;
  product_id: number;
  content: string;
  rank_score: number;
}

export class HybridSearcher {
  private config: HybridSearchConfig;

  constructor(config: Partial<HybridSearchConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 执行混合检索
   */
  async search(
    query: string,
    embedding: number[],
    supabase: SupabaseClient,
    options?: { productIds?: number[] }
  ): Promise<{ results: ScoredChunk[]; step: Omit<RAGStep, 'name' | 'type'> }> {
    const startTime = Date.now();

    // 并行执行 Dense 和 Sparse 检索
    const [denseResults, sparseResults] = await Promise.all([
      this.denseSearch(embedding, supabase, options?.productIds),
      this.sparseSearch(query, supabase, options?.productIds),
    ]);

    // 融合结果
    const fused = this.fuse(denseResults, sparseResults);

    return {
      results: fused,
      step: {
        startTime,
        endTime: Date.now(),
        input: { query, hasEmbedding: true, productIds: options?.productIds },
        output: {
          denseCount: denseResults.length,
          sparseCount: sparseResults.length,
          fusedCount: fused.length,
          fusionMethod: this.config.fusionMethod,
        },
      },
    };
  }

  /**
   * Dense Vector Search - pgvector cosine similarity
   */
  private async denseSearch(
    embedding: number[],
    supabase: SupabaseClient,
    productIds?: number[]
  ): Promise<RawDenseResult[]> {
    try {
      const { data, error } = await withTimeout(
        supabase.rpc('match_clauses', {
          query_embedding: embedding,
          match_threshold: this.config.matchThreshold,
          match_count: this.config.denseTopK,
        }),
        'Dense vector search'
      );

      if (error) {
        console.error('[HybridSearch] Dense search error:', error);
        return [];
      }

      let results: RawDenseResult[] = data || [];

      // 如果指定了产品 ID，过滤
      if (productIds && productIds.length > 0) {
        results = results.filter(r => productIds.includes(r.product_id));
      }

      return results;
    } catch (error) {
      console.error('[HybridSearch] Dense search failed:', error);
      return [];
    }
  }

  /**
   * Sparse Search - PostgreSQL 全文检索
   * 使用 to_tsvector + ts_rank 实现 BM25-like 行为
   * 
   * 注意：对中文需要 zhparser 扩展或应用层分词
   * 这里使用 ilike + 简单 tf-idf 近似作为 Supabase 兼容方案
   */
  private async sparseSearch(
    query: string,
    supabase: SupabaseClient,
    productIds?: number[]
  ): Promise<RawSparseResult[]> {
    // 提取关键词（简单中文分词：按标点和常用词切分）
    const keywords = this.extractKeywords(query);
    if (keywords.length === 0) return [];

    // 使用 OR 逻辑匹配，计算匹配关键词数作为 rank_score
    // 这是应用层 BM25 的简化版本
    let queryBuilder = supabase
      .from('clauses')
      .select('id, product_id, content');

    if (productIds && productIds.length > 0) {
      queryBuilder = queryBuilder.in('product_id', productIds);
    }

    // 构建 OR 条件
    const escapeIlike = (value: string) => value.replace(/[%_,()]/g, '').trim();
    const safeKeywords = keywords.map(escapeIlike).filter(Boolean);
    if (safeKeywords.length === 0) return [];

    const orConditions = safeKeywords.map(kw => `content.ilike.%${kw}%`).join(',');
    queryBuilder = queryBuilder.or(orConditions);
    queryBuilder = queryBuilder.limit(this.config.sparseTopK);

    let data: { id: number; product_id: number; content: string }[] = [];
    try {
      const result = await withTimeout(queryBuilder, 'Sparse keyword search');
      if (result.error) {
        console.error('[HybridSearch] Sparse search error:', result.error);
        return [];
      }
      data = result.data || [];
    } catch (error) {
      console.error('[HybridSearch] Sparse search failed:', error);
      return [];
    }

    // 计算每条结果的 BM25-like 分数（关键词命中率）
    return data.map(row => {
      const content = (row.content || '').toLowerCase();
      let hitCount = 0;
      for (const kw of safeKeywords) {
        if (content.includes(kw.toLowerCase())) {
          hitCount++;
        }
      }
      return {
        id: row.id,
        product_id: row.product_id,
        content: row.content,
        rank_score: hitCount / safeKeywords.length, // 归一化到 0-1
      };
    }).sort((a, b) => b.rank_score - a.rank_score);
  }

  /**
   * 简易中文关键词提取
   */
  private extractKeywords(query: string): string[] {
    // 去除停用词，按 2-4 字 n-gram 切分
    const stopWords = new Set(['的', '了', '是', '在', '和', '与', '或', '及', '等', '中', '为', '有', '到', '不', '也', '这', '那']);

    // 先按标点切分
    const segments = query.split(/[，。！？、；：""''【】（）\s]+/).filter(s => s.length > 0);

    const keywords: string[] = [];
    for (const seg of segments) {
      if (seg.length <= 4 && !stopWords.has(seg)) {
        keywords.push(seg);
      } else {
        // 对长段落做 bi-gram
        for (let i = 0; i < seg.length - 1; i++) {
          const bigram = seg.slice(i, i + 2);
          if (!stopWords.has(bigram)) {
            keywords.push(bigram);
          }
        }
      }
    }

    // 去重
    return [...new Set(keywords)].slice(0, 10);
  }

  /**
   * RRF (Reciprocal Rank Fusion)
   * score(d) = Σ 1 / (k + rank_i(d))
   */
  private fuse(
    denseResults: RawDenseResult[],
    sparseResults: RawSparseResult[]
  ): ScoredChunk[] {
    const scoreMap = new Map<number, {
      denseRank: number;
      sparseRank: number;
      denseScore: number;
      sparseScore: number;
      content: string;
      productId: number;
    }>();

    // 记录 Dense 排名
    denseResults.forEach((r, idx) => {
      scoreMap.set(r.id, {
        denseRank: idx + 1,
        sparseRank: Infinity,
        denseScore: r.similarity,
        sparseScore: 0,
        content: r.content,
        productId: r.product_id,
      });
    });

    // 记录 Sparse 排名
    sparseResults.forEach((r, idx) => {
      const existing = scoreMap.get(r.id);
      if (existing) {
        existing.sparseRank = idx + 1;
        existing.sparseScore = r.rank_score;
      } else {
        scoreMap.set(r.id, {
          denseRank: Infinity,
          sparseRank: idx + 1,
          denseScore: 0,
          sparseScore: r.rank_score,
          content: r.content,
          productId: r.product_id,
        });
      }
    });

    // 计算融合分数
    const results: ScoredChunk[] = [];
    const k = this.config.rrfK;

    for (const [id, info] of scoreMap) {
      let score: number;

      switch (this.config.fusionMethod) {
        case 'rrf':
          score = 0;
          if (info.denseRank !== Infinity) {
            score += this.config.denseWeight * (1 / (k + info.denseRank));
          }
          if (info.sparseRank !== Infinity) {
            score += this.config.sparseWeight * (1 / (k + info.sparseRank));
          }
          break;

        case 'weighted_sum':
          score = this.config.denseWeight * info.denseScore +
            this.config.sparseWeight * info.sparseScore;
          break;

        case 'convex_combination':
          score = this.config.denseWeight * info.denseScore +
            (1 - this.config.denseWeight) * info.sparseScore;
          break;

        default:
          score = info.denseScore;
      }

      const chunk: Chunk = {
        id: String(id),
        content: info.content,
        metadata: {
          productId: info.productId,
        } as ChunkMetadata,
      };

      results.push({
        chunk,
        score,
        scoreType: 'hybrid',
      });
    }

    // 按融合分数降序排列
    results.sort((a, b) => b.score - a.score);

    return results;
  }
}
