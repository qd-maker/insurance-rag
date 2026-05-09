/**
 * RAG Pipeline 统一入口
 * 
 * 架构：Query → Router → Retriever(HyDE/Hybrid/Rerank) → Compressor → Generator
 * 
 * 设计原则：
 * 1. 每个阶段独立模块，可单独测试和替换
 * 2. Pipeline 配置化，支持 A/B 对比
 * 3. 全链路 Tracing（LangFuse 集成）
 */

export { RAGPipeline, type RAGPipelineConfig } from './pipeline';
export { QueryRouter, type QueryType, type RoutingDecision } from './query-router';
export { HyDERetriever } from './hyde';
export { HybridSearcher, type HybridSearchConfig } from './hybrid-search';
export { Reranker, type RerankConfig } from './reranker';
export { ContextCompressor } from './context-compressor';
export { StreamingGenerator } from './generator';
export { SemanticChunker, type ChunkingConfig } from './chunker';
export { DocumentIngestionPipeline } from './ingestion';
export { RAGTracer } from './tracing';
export { RAGEvaluator, generateEvalReport, type EvalMetrics, type EvalInput } from './evaluation';
export { type RAGTrace, type RAGStep, type PipelineConfig, DEFAULT_PIPELINE_CONFIG } from './types';
