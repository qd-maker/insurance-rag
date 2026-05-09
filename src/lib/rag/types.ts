/**
 * RAG Pipeline 核心类型定义
 */

// ========== 文档 & Chunk 类型 ==========

export interface Document {
  id: string;
  content: string;
  metadata: DocumentMetadata;
}

export interface DocumentMetadata {
  productId?: number;
  productName?: string;
  source?: string;
  chunkIndex?: number;
  totalChunks?: number;
  sectionTitle?: string;
  pageNumber?: number;
}

export interface Chunk {
  id: string;
  content: string;
  embedding?: number[];
  metadata: ChunkMetadata;
}

export interface ChunkMetadata extends DocumentMetadata {
  startChar?: number;
  endChar?: number;
  overlapPrev?: boolean;
  overlapNext?: boolean;
  tokenCount?: number;
}

// ========== 检索结果 ==========

export interface RetrievalResult {
  chunks: ScoredChunk[];
  strategy: RetrievalStrategy;
  metadata: RetrievalMetadata;
}

export interface ScoredChunk {
  chunk: Chunk;
  score: number;
  scoreType: 'dense' | 'sparse' | 'hybrid' | 'rerank';
}

export type RetrievalStrategy =
  | 'direct_lookup'     // 已知产品，直接按 ID 取
  | 'hyde_dense'        // HyDE + Dense
  | 'hybrid_rrf'       // BM25 + Dense + RRF
  | 'hybrid_rerank'    // Hybrid + Reranker
  | 'fallback_sparse'  // 降级到纯 BM25
  | 'failed';

export interface RetrievalMetadata {
  totalCandidates: number;
  afterRerank: number;
  queryType: string;
  hydeUsed: boolean;
  rerankModel?: string;
  latencyMs: number;
}

// ========== Query 类型 ==========

export type QueryIntent =
  | 'product_summary'     // 产品结构化摘要（原有场景）
  | 'specific_question'   // 具体问题（如"这个险种赔不赔？"）
  | 'comparison'          // 产品对比
  | 'general_qa';         // 通用问答

export interface ParsedQuery {
  original: string;
  normalized: string;
  intent: QueryIntent;
  entities: {
    productNames: string[];
    keywords: string[];
  };
  complexity: 'simple' | 'moderate' | 'complex';
}

// ========== 生成相关 ==========

export interface GenerationContext {
  query: ParsedQuery;
  chunks: ScoredChunk[];
  compressedContext: string;
  systemPrompt: string;
}

export interface GenerationResult {
  content: any; // structured JSON output
  tokensUsed: { prompt: number; completion: number };
  model: string;
  latencyMs: number;
}

// ========== Tracing ==========

export interface RAGTrace {
  traceId: string;
  sessionId?: string;
  startTime: number;
  endTime?: number;
  steps: RAGStep[];
  finalResult?: any;
  error?: string;
}

export interface RAGStep {
  name: string;
  type: 'query_parse' | 'routing' | 'hyde' | 'retrieval' | 'rerank' | 'compression' | 'generation';
  startTime: number;
  endTime: number;
  input: any;
  output: any;
  metadata?: Record<string, any>;
}

// ========== Pipeline 配置 ==========

export interface PipelineConfig {
  // Retrieval
  enableHyDE: boolean;
  enableRerank: boolean;
  enableBM25: boolean;
  retrievalTopK: number;
  rerankTopK: number;
  similarityThreshold: number;

  // Chunking
  chunkSize: number;
  chunkOverlap: number;
  chunkingStrategy: 'recursive' | 'semantic' | 'hybrid';

  // Generation
  model: string;
  temperature: number;
  streaming: boolean;
  maxTokens: number;

  // Context
  maxContextTokens: number;
  compressionEnabled: boolean;

  // Tracing
  tracingEnabled: boolean;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  enableHyDE: true,
  enableRerank: true,
  enableBM25: true,
  retrievalTopK: 20,
  rerankTopK: 5,
  similarityThreshold: 0.3,

  chunkSize: 512,
  chunkOverlap: 50,
  chunkingStrategy: 'semantic',

  model: 'gpt-4o-mini',
  temperature: 0.1,
  streaming: true,
  maxTokens: 4096,

  maxContextTokens: 4000,
  compressionEnabled: true,

  tracingEnabled: true,
};
