/**
 * Document Ingestion Pipeline
 * 
 * 完整流程：PDF/Text → Parse → Chunk → Embed → Store
 * 
 * 支持的文档格式：
 * 1. PDF（pdf-parse 解析）
 * 2. 纯文本（直接处理）
 * 3. Markdown（保留结构）
 * 
 * 未来扩展：
 * - LlamaParse API（更好的 PDF 表格识别）
 * - OCR 支持
 * - 多语言
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { SemanticChunker, ChunkingConfig } from './chunker';
import { embedText } from '../embeddings';
import { Chunk } from './types';

export interface IngestionConfig {
  chunking: Partial<ChunkingConfig>;
  batchSize: number;           // Embedding 批处理大小
  concurrency: number;         // 并行 embedding 数
  storeEmbeddings: boolean;    // 是否存储 embedding（调试时可关闭）
}

const DEFAULT_CONFIG: IngestionConfig = {
  chunking: {
    strategy: 'hybrid',
    chunkSize: 512,
    chunkOverlap: 50,
  },
  batchSize: 10,
  concurrency: 3,
  storeEmbeddings: true,
};

export interface IngestionResult {
  productId: number;
  totalChunks: number;
  totalCharacters: number;
  embeddingsDim: number;
  processingTimeMs: number;
  errors: string[];
}

export class DocumentIngestionPipeline {
  private config: IngestionConfig;
  private chunker: SemanticChunker;

  constructor(config: Partial<IngestionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.chunker = new SemanticChunker(this.config.chunking);
  }

  /**
   * 完整 Ingestion 流程：解析 → 分段 → 向量化 → 存储
   */
  async ingest(
    content: string,
    productName: string,
    supabase: SupabaseClient,
    options?: { productId?: number; source?: string }
  ): Promise<IngestionResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    // Step 1: 确保产品存在
    let productId = options?.productId;
    if (!productId) {
      const { data: existing } = await supabase
        .from('products')
        .select('id')
        .eq('name', productName)
        .maybeSingle();

      if (existing) {
        productId = existing.id;
      } else {
        const { data: newProduct, error: createErr } = await supabase
          .from('products')
          .insert({ name: productName, is_active: true })
          .select('id')
          .single();

        if (createErr || !newProduct) {
          throw new Error(`Failed to create product: ${createErr?.message}`);
        }
        productId = newProduct.id;
      }
    }

    // Step 2: 智能分段
    const chunks = await this.chunker.chunk(content, {
      productId,
      productName,
      source: options?.source,
    });

    console.log(`[Ingestion] Chunked into ${chunks.length} chunks for product "${productName}"`);

    // Step 3: 批量向量化 + 存储
    let embeddingsDim = 0;
    const batches = this.batchArray(chunks, this.config.batchSize);

    for (const batch of batches) {
      const embedResults = await this.embedBatch(batch, errors);

      // 存储到 Supabase
      if (this.config.storeEmbeddings) {
        const rows = embedResults.map(({ chunk, embedding }) => ({
          product_id: productId,
          content: chunk.content,
          embedding,
        }));

        const { error: insertErr } = await supabase
          .from('clauses')
          .insert(rows);

        if (insertErr) {
          errors.push(`Insert error: ${insertErr.message}`);
          console.error('[Ingestion] Insert error:', insertErr);
        }
      }

      if (embedResults.length > 0 && embedResults[0].embedding) {
        embeddingsDim = embedResults[0].embedding.length;
      }
    }

    return {
      productId: productId!,
      totalChunks: chunks.length,
      totalCharacters: content.length,
      embeddingsDim,
      processingTimeMs: Date.now() - startTime,
      errors,
    };
  }

  /**
   * 从 PDF Buffer 导入
   */
  async ingestPDF(
    pdfBuffer: Buffer,
    productName: string,
    supabase: SupabaseClient
  ): Promise<IngestionResult> {
    // 动态导入 pdf-parse
    let pdfParse: any;
    try {
      pdfParse = (await import('pdf-parse')).default;
    } catch {
      throw new Error('pdf-parse not installed. Run: npm install pdf-parse');
    }

    const pdfData = await pdfParse(pdfBuffer);
    const text = pdfData.text;

    console.log(`[Ingestion] Parsed PDF: ${pdfData.numpages} pages, ${text.length} chars`);

    return this.ingest(text, productName, supabase, { source: 'pdf' });
  }

  /**
   * 批量 Embedding（带并发控制）
   */
  private async embedBatch(
    chunks: Chunk[],
    errors: string[]
  ): Promise<{ chunk: Chunk; embedding: number[] }[]> {
    const results: { chunk: Chunk; embedding: number[] }[] = [];

    // 并发控制
    const concurrencyLimit = this.config.concurrency;
    for (let i = 0; i < chunks.length; i += concurrencyLimit) {
      const batch = chunks.slice(i, i + concurrencyLimit);
      const embedPromises = batch.map(async (chunk) => {
        try {
          const embedding = await embedText(chunk.content);
          return { chunk, embedding };
        } catch (err: any) {
          errors.push(`Embedding failed for chunk ${chunk.id}: ${err.message}`);
          return null;
        }
      });

      const batchResults = await Promise.all(embedPromises);
      results.push(...batchResults.filter(Boolean) as any[]);
    }

    return results;
  }

  /**
   * 数组分批
   */
  private batchArray<T>(arr: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      batches.push(arr.slice(i, i + size));
    }
    return batches;
  }
}
