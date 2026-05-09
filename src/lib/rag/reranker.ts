/**
 * Cross-encoder Reranker
 * 
 * 核心思想：
 * - 初次检索（bi-encoder）是粗排，速度快但精度有限
 * - Reranker（cross-encoder）是精排，将 query-doc pair 一起编码，精度高但速度慢
 * - 典型流程：粗排 Top-20 → 精排 Top-5
 * 
 * 支持的 Reranker：
 * 1. Cohere Rerank API (推荐，效果好)
 * 2. Jina Reranker API
 * 3. LLM-based reranking (用 GPT 打分)
 * 4. BGE-reranker (本地模型，需要独立服务)
 */

import { ScoredChunk, RAGStep } from './types';

export interface RerankConfig {
  provider: 'cohere' | 'jina' | 'llm' | 'bge';
  model?: string;
  topK: number;
  returnScores: boolean;
}

const DEFAULT_CONFIG: RerankConfig = {
  provider: 'jina',
  model: 'jina-reranker-v2-base-multilingual',
  topK: 5,
  returnScores: true,
};

const RERANK_TIMEOUT_MS = 8000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

async function withTimeout<T>(
  promise: PromiseLike<T>,
  label: string,
  timeoutMs = RERANK_TIMEOUT_MS
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

interface RerankResult {
  index: number;
  relevance_score: number;
  score?: number;
}

export class Reranker {
  private config: RerankConfig;

  constructor(config: Partial<RerankConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 对检索结果进行精排
   */
  async rerank(
    query: string,
    chunks: ScoredChunk[]
  ): Promise<{ results: ScoredChunk[]; step: Omit<RAGStep, 'name' | 'type'> }> {
    const startTime = Date.now();

    if (chunks.length === 0) {
      return {
        results: [],
        step: { startTime, endTime: Date.now(), input: { query }, output: { count: 0 } },
      };
    }

    let reranked: RerankResult[];

    switch (this.config.provider) {
      case 'jina':
        reranked = await this.jinaRerank(query, chunks);
        break;
      case 'cohere':
        reranked = await this.cohereRerank(query, chunks);
        break;
      case 'llm':
        reranked = await this.llmRerank(query, chunks);
        break;
      default:
        // Fallback: 保持原有排序
        reranked = chunks.map((_, idx) => ({ index: idx, relevance_score: 1 - idx * 0.1 }));
    }

    // 按 rerank 分数重新排序，取 topK
    const sortedResults = reranked
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, this.config.topK)
      .map(r => ({
        ...chunks[r.index],
        score: r.relevance_score,
        scoreType: 'rerank' as const,
      }));

    return {
      results: sortedResults,
      step: {
        startTime,
        endTime: Date.now(),
        input: {
          query,
          candidateCount: chunks.length,
        },
        output: {
          provider: this.config.provider,
          model: this.config.model,
          topK: this.config.topK,
          resultCount: sortedResults.length,
          topScore: sortedResults[0]?.score || 0,
        },
      },
    };
  }

  /**
   * Jina Reranker API
   * https://jina.ai/reranker/
   */
  private async jinaRerank(query: string, chunks: ScoredChunk[]): Promise<RerankResult[]> {
    const apiKey = process.env.JINA_API_KEY;
    if (!apiKey) {
      console.warn('[Reranker] JINA_API_KEY not set, falling back to score passthrough');
      return chunks.map((c, idx) => ({ index: idx, relevance_score: c.score }));
    }

    try {
      const response = await withTimeout(fetch('https://api.jina.ai/v1/rerank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model || 'jina-reranker-v2-base-multilingual',
          query,
          documents: chunks.map(c => c.chunk.content),
          top_n: this.config.topK,
          return_documents: false,
        }),
      }), 'Jina rerank');

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[Reranker] Jina API error (${response.status}):`, errText);
        return chunks.map((c, idx) => ({ index: idx, relevance_score: c.score }));
      }

      const data = await response.json() as { results?: RerankResult[] };
      return (data.results || []).map((r) => ({
        index: r.index,
        relevance_score: r.relevance_score,
      }));
    } catch (error: unknown) {
      console.error('[Reranker] Jina API call failed:', errorMessage(error));
      return chunks.map((c, idx) => ({ index: idx, relevance_score: c.score }));
    }
  }

  /**
   * Cohere Rerank API
   * https://docs.cohere.com/reference/rerank
   */
  private async cohereRerank(query: string, chunks: ScoredChunk[]): Promise<RerankResult[]> {
    const apiKey = process.env.COHERE_API_KEY;
    if (!apiKey) {
      console.warn('[Reranker] COHERE_API_KEY not set, falling back');
      return chunks.map((c, idx) => ({ index: idx, relevance_score: c.score }));
    }

    try {
      const response = await withTimeout(fetch('https://api.cohere.ai/v1/rerank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model || 'rerank-multilingual-v3.0',
          query,
          documents: chunks.map(c => ({ text: c.chunk.content })),
          top_n: this.config.topK,
          return_documents: false,
        }),
      }), 'Cohere rerank');

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[Reranker] Cohere API error (${response.status}):`, errText);
        return chunks.map((c, idx) => ({ index: idx, relevance_score: c.score }));
      }

      const data = await response.json() as { results?: RerankResult[] };
      return (data.results || []).map((r) => ({
        index: r.index,
        relevance_score: r.relevance_score,
      }));
    } catch (error: unknown) {
      console.error('[Reranker] Cohere API call failed:', errorMessage(error));
      return chunks.map((c, idx) => ({ index: idx, relevance_score: c.score }));
    }
  }

  /**
   * LLM-based Reranking
   * 让 GPT 为每个 query-doc pair 打分（适合无 Reranker API 的情况）
   */
  private async llmRerank(query: string, chunks: ScoredChunk[]): Promise<RerankResult[]> {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    });

    const prompt = `你是一个相关性评分器。对于给定的查询和文档列表，请为每个文档的相关性打分（0-10分）。
只输出 JSON 数组，格式：[{"index": 0, "score": 8}, ...]

查询：${query}

文档列表：
${chunks.map((c, i) => `[${i}] ${c.chunk.content.slice(0, 200)}`).join('\n')}

请输出评分 JSON：`;

    try {
      const response = await withTimeout(
        openai.chat.completions.create({
          model: process.env.GENERATION_MODEL || 'gpt-4o-mini',
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        }),
        'LLM rerank'
      );

      const text = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(text) as { scores?: RerankResult[]; results?: RerankResult[] } | RerankResult[];
      const scores = Array.isArray(parsed) ? parsed : parsed.scores || parsed.results || [];

      return scores.map((s) => ({
        index: s.index,
        relevance_score: s.relevance_score ?? ((s.score || 0) / 10),
      }));
    } catch (error: unknown) {
      console.error('[Reranker] LLM rerank failed:', errorMessage(error));
      return chunks.map((c, idx) => ({ index: idx, relevance_score: c.score }));
    }
  }
}
