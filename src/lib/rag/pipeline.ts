/**
 * RAG Pipeline 主编排器
 * 
 * 完整流程：
 * Query → Router → [HyDE] → Hybrid Search → Rerank → Compress → Generate
 * 
 * 每一步都生成 RAGStep trace，支持 LangFuse 上报
 * 支持配置化 A/B 对比实验
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { QueryRouter } from './query-router';
import { HyDERetriever } from './hyde';
import { HybridSearcher } from './hybrid-search';
import { Reranker } from './reranker';
import { ContextCompressor } from './context-compressor';
import { StreamingGenerator } from './generator';
import { embedText } from '../embeddings';
import {
  PipelineConfig,
  DEFAULT_PIPELINE_CONFIG,
  RAGTrace,
  RAGStep,
  ScoredChunk,
  ParsedQuery,
  GenerationResult,
  Chunk,
  ChunkMetadata,
} from './types';

export type RAGPipelineConfig = PipelineConfig;

export interface PipelineResult {
  result: GenerationResult;
  trace: RAGTrace;
  cached: boolean;
}

export class RAGPipeline {
  private config: PipelineConfig;
  private router: QueryRouter;
  private hyde: HyDERetriever;
  private searcher: HybridSearcher;
  private reranker: Reranker;
  private compressor: ContextCompressor;
  private generator: StreamingGenerator;

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };

    this.router = new QueryRouter();
    this.hyde = new HyDERetriever({ model: this.config.model });
    this.searcher = new HybridSearcher({
      denseTopK: this.config.retrievalTopK,
      sparseTopK: this.config.retrievalTopK,
      matchThreshold: this.config.similarityThreshold,
    });
    this.reranker = new Reranker({ topK: this.config.rerankTopK });
    this.compressor = new ContextCompressor({
      maxTokens: this.config.maxContextTokens,
    });
    this.generator = new StreamingGenerator({
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      streaming: this.config.streaming,
    });
  }

  /**
   * 更新已知产品列表（用于 Router 精确匹配）
   */
  updateProductNames(names: string[]) {
    this.router.updateProductNames(names);
  }

  /**
   * 执行完整 RAG Pipeline（非流式）
   */
  async execute(
    query: string,
    supabase: SupabaseClient
  ): Promise<PipelineResult> {
    const trace: RAGTrace = {
      traceId: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      startTime: Date.now(),
      steps: [],
    };

    try {
      // ========== Step 1: 获取产品列表（Router 需要已知产品名来做精确匹配） ==========
      const { data: allProducts } = await supabase
        .from('products')
        .select('id, name')
        .eq('is_active', true);
      const productNames: Record<number, string> = {};
      const productNameList: string[] = [];
      for (const p of allProducts || []) {
        productNames[p.id] = p.name;
        productNameList.push(p.name);
      }
      this.router.updateProductNames(productNameList);

      // ========== Step 2: Query Routing（依赖已知产品列表） ==========
      const routeStart = Date.now();
      const { parsed, decision } = await this.router.route(query);
      trace.steps.push({
        name: 'Query Routing',
        type: 'routing',
        startTime: routeStart,
        endTime: Date.now(),
        input: { query },
        output: { intent: parsed.intent, strategy: decision.strategy, reasoning: decision.reasoning },
      });

      // 合并路由决策到 pipeline 配置
      const runConfig = { ...this.config, ...decision.config };

      // ========== Step 3: Direct Lookup or HyDE ==========
      let embedding: number[];
      let hydeHypothesis: string | null = null;

      if (decision.strategy === 'direct' && parsed.entities.productNames.length > 0) {
        // 直接按产品名取全量条款
        const stripParens = (s: string) => s.replace(/[（(][^)）]*[)）]/g, '').trim();
        const matchedProduct = allProducts?.find(p => {
          const pCore = stripParens(p.name);
          return parsed.entities.productNames.some(name => {
            const nCore = stripParens(name);
            return p.name.includes(name) || name.includes(p.name) ||
              pCore.includes(nCore) || nCore.includes(pCore);
          });
        });

        if (matchedProduct) {
          const directStart = Date.now();
          const { data: clauses } = await supabase
            .from('clauses')
            .select('id, product_id, content')
            .eq('product_id', matchedProduct.id)
            .order('id', { ascending: true });

          const directChunks: ScoredChunk[] = (clauses || []).map((c: any) => ({
            chunk: {
              id: String(c.id),
              content: c.content,
              metadata: { productId: c.product_id } as ChunkMetadata,
            } as Chunk,
            score: 1.0,
            scoreType: 'dense' as const,
          }));

          trace.steps.push({
            name: 'Direct Product Lookup',
            type: 'retrieval',
            startTime: directStart,
            endTime: Date.now(),
            input: { productName: matchedProduct.name, productId: matchedProduct.id },
            output: { chunkCount: directChunks.length },
          });

          // 跳过 HyDE/Search/Rerank，直接压缩和生成
          return await this.compressAndGenerate(
            parsed, directChunks, productNames, trace, runConfig
          );
        }

        // 匹配失败，fallback 到标准流程
        embedding = await embedText(query);
      } else if (runConfig.enableHyDE) {
        // HyDE 增强
        const hydeResult = await this.hyde.getHyDEEmbedding(query);
        embedding = hydeResult.embedding;
        hydeHypothesis = hydeResult.hypothesis;
        trace.steps.push({
          name: 'HyDE Generation',
          type: 'hyde',
          ...hydeResult.step,
        } as RAGStep);
      } else {
        embedding = await embedText(query);
      }

      // ========== Step 4: Hybrid Search ==========
      const searchResult = await this.searcher.search(
        query,
        embedding,
        supabase,
        {
          productIds: parsed.entities.productNames.length > 0
            ? this.resolveProductIds(parsed.entities.productNames, allProducts || [])
            : undefined
        }
      );
      trace.steps.push({
        name: 'Hybrid Search (BM25 + Dense + RRF)',
        type: 'retrieval',
        ...searchResult.step,
      } as RAGStep);

      let chunks = searchResult.results;

      // ========== Step 5: Reranking ==========
      if (runConfig.enableRerank && chunks.length > 0) {
        const rerankResult = await this.reranker.rerank(query, chunks);
        trace.steps.push({
          name: 'Cross-encoder Reranking',
          type: 'rerank',
          ...rerankResult.step,
        } as RAGStep);
        chunks = rerankResult.results;
      }

      // ========== Step 6: Compress & Generate ==========
      return await this.compressAndGenerate(parsed, chunks, productNames, trace, runConfig);

    } catch (error: any) {
      trace.error = error.message;
      trace.endTime = Date.now();
      return {
        result: {
          content: { error: error.message },
          tokensUsed: { prompt: 0, completion: 0 },
          model: this.config.model,
          latencyMs: Date.now() - trace.startTime,
        },
        trace,
        cached: false,
      };
    }
  }

  /**
   * 流式执行（返回 ReadableStream）
   */
  async executeStream(
    query: string,
    supabase: SupabaseClient
  ): Promise<{ stream: ReadableStream<Uint8Array>; trace: RAGTrace }> {
    const trace: RAGTrace = {
      traceId: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      startTime: Date.now(),
      steps: [],
    };

    // 执行检索步骤（非流式部分）
    const { data: allProducts } = await supabase
      .from('products')
      .select('id, name')
      .eq('is_active', true);
    const productNames: Record<number, string> = {};
    const productNameList: string[] = [];
    for (const p of allProducts || []) {
      productNames[p.id] = p.name;
      productNameList.push(p.name);
    }
    this.router.updateProductNames(productNameList);

    const { parsed, decision } = await this.router.route(query);
    const runConfig = { ...this.config, ...decision.config };

    // 获取 embedding
    let embedding: number[];
    if (runConfig.enableHyDE) {
      const hydeResult = await this.hyde.getHyDEEmbedding(query);
      embedding = hydeResult.embedding;
    } else {
      embedding = await embedText(query);
    }

    // 混合检索（有产品名时按 product_id 过滤）
    const searchResult = await this.searcher.search(query, embedding, supabase, {
      productIds: parsed.entities.productNames.length > 0
        ? this.resolveProductIds(parsed.entities.productNames, allProducts || [])
        : undefined,
    });
    let chunks = searchResult.results;

    // Reranking
    if (runConfig.enableRerank && chunks.length > 0) {
      const rerankResult = await this.reranker.rerank(query, chunks);
      chunks = rerankResult.results;
    }

    // 压缩
    const compressResult = await this.compressor.compress(query, chunks);
    const context = compressResult.context;

    // 创建流式生成
    const stream = this.generator.createStream(parsed, chunks, context, productNames);

    trace.endTime = Date.now();
    return { stream, trace };
  }

  /**
   * 压缩上下文并生成
   */
  private async compressAndGenerate(
    parsed: ParsedQuery,
    chunks: ScoredChunk[],
    productNames: Record<number, string>,
    trace: RAGTrace,
    config: PipelineConfig
  ): Promise<PipelineResult> {
    // Context Compression
    const compressResult = await this.compressor.compress(parsed.original, chunks);
    trace.steps.push({
      name: 'Context Compression',
      type: 'compression',
      ...compressResult.step,
    } as RAGStep);

    // Generation
    const genResult = await this.generator.generate(
      parsed, chunks, compressResult.context, productNames
    );
    trace.steps.push({
      name: 'LLM Generation',
      type: 'generation',
      ...genResult.step,
    } as RAGStep);

    // 添加 sources 和 clauseMap 到结果
    const content = genResult.result.content;
    content.sources = chunks.map(c => ({
      clauseId: parseInt(c.chunk.id),
      productName: c.chunk.metadata.productId ? productNames[c.chunk.metadata.productId] : null,
    }));
    content.clauseMap = {};
    for (const c of chunks) {
      content.clauseMap[c.chunk.id] = {
        snippet: c.chunk.content.slice(0, 2000),
        productName: c.chunk.metadata.productId ? productNames[c.chunk.metadata.productId] : null,
      };
    }

    trace.endTime = Date.now();
    trace.finalResult = content;

    return {
      result: genResult.result,
      trace,
      cached: false,
    };
  }

  /**
   * 将产品名解析为 product_id 列表
   */
  private resolveProductIds(
    names: string[],
    products: { id: number; name: string }[]
  ): number[] {
    const ids: number[] = [];
    const stripParens = (s: string) => s.replace(/[（(][^)）]*[)）]/g, '').trim();
    for (const name of names) {
      const nameCore = stripParens(name);
      const match = products.find(p => {
        const pCore = stripParens(p.name);
        return p.name.includes(name) || name.includes(p.name) ||
          pCore.includes(nameCore) || nameCore.includes(pCore);
      });
      if (match) ids.push(match.id);
    }
    return ids;
  }

  /**
   * 获取当前 pipeline 配置（用于 A/B 对比展示）
   */
  getConfig(): PipelineConfig {
    return { ...this.config };
  }
}
