/**
 * Semantic Chunker - 智能语义分段
 * 
 * 三种策略：
 * 1. Recursive: 递归按分隔符切分 + overlap
 * 2. Semantic: 基于句子 embedding 相似度，在语义断裂处切分
 * 3. Hybrid: 先按结构（标题）粗切，再按 semantic 细切
 * 
 * 关键改进（对比原 chunking.ts）：
 * - 支持 overlap（滑动窗口重叠，避免信息丢失在边界）
 * - 支持 semantic splitting（按语义变化点切分）
 * - 保留 chunk 元数据（位置、所属段落等）
 * - token 计数感知
 */

import { Chunk, ChunkMetadata } from './types';
import { embedText } from '../embeddings';

export interface ChunkingConfig {
  strategy: 'recursive' | 'semantic' | 'hybrid';
  chunkSize: number;       // 目标 chunk 大小（字符数）
  chunkOverlap: number;    // 重叠大小（字符数）
  minChunkSize: number;    // 最小 chunk 大小（防止过小碎片）
  // Semantic chunking params
  semanticThreshold: number; // 语义断裂阈值（cosine distance）
  // Metadata
  includeMetadata: boolean;
}

const DEFAULT_CONFIG: ChunkingConfig = {
  strategy: 'hybrid',
  chunkSize: 512,
  chunkOverlap: 50,
  minChunkSize: 100,
  semanticThreshold: 0.3,
  includeMetadata: true,
};

export class SemanticChunker {
  private config: ChunkingConfig;

  constructor(config: Partial<ChunkingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 对文档进行智能分段
   */
  async chunk(
    content: string,
    metadata?: Partial<ChunkMetadata>
  ): Promise<Chunk[]> {
    if (!content || !content.trim()) return [];

    switch (this.config.strategy) {
      case 'recursive':
        return this.recursiveChunk(content, metadata);
      case 'semantic':
        return await this.semanticChunk(content, metadata);
      case 'hybrid':
      default:
        return await this.hybridChunk(content, metadata);
    }
  }

  /**
   * 策略 1: Recursive Chunking
   * 按优先级递归分割：标题 > 段落 > 句子 > 字符
   * 类似 LangChain 的 RecursiveCharacterTextSplitter
   */
  private recursiveChunk(content: string, metadata?: Partial<ChunkMetadata>): Chunk[] {
    const separators = [
      /(?=【[^】]{1,20}】)/,                    // 中文方括号标题
      /(?=(?:^|\n)(?:一|二|三|四|五|六|七|八|九|十)[、.．])/m, // 中文数字序号
      /(?=(?:^|\n)#{1,3}\s)/m,                 // Markdown 标题
      /(?=(?:^|\n)\d+[.、．])/m,               // 数字序号
      /\n\n/,                                   // 空行
      /\n/,                                     // 换行
      /[。！？；]/,                              // 句号
    ];

    const chunks = this.splitRecursive(content, separators, 0);
    return this.createChunksWithOverlap(chunks, metadata);
  }

  /**
   * 递归分割核心逻辑
   */
  private splitRecursive(text: string, separators: RegExp[], level: number): string[] {
    if (text.length <= this.config.chunkSize) {
      return [text];
    }

    if (level >= separators.length) {
      // 无法再细分，硬切
      return this.hardSplit(text);
    }

    const separator = separators[level];
    const parts = text.split(separator).filter(s => s.trim().length > 0);

    if (parts.length <= 1) {
      // 当前分隔符无效，尝试下一级
      return this.splitRecursive(text, separators, level + 1);
    }

    // 合并小段落直到达到 chunkSize
    const result: string[] = [];
    let current = '';

    for (const part of parts) {
      if (current.length + part.length > this.config.chunkSize && current.length > 0) {
        result.push(current.trim());
        current = part;
      } else {
        current += part;
      }
    }
    if (current.trim()) {
      result.push(current.trim());
    }

    // 对超长的 chunk 递归处理
    const finalResult: string[] = [];
    for (const chunk of result) {
      if (chunk.length > this.config.chunkSize * 1.5) {
        finalResult.push(...this.splitRecursive(chunk, separators, level + 1));
      } else {
        finalResult.push(chunk);
      }
    }

    return finalResult;
  }

  /**
   * 硬切（最后手段）
   */
  private hardSplit(text: string): string[] {
    const result: string[] = [];
    for (let i = 0; i < text.length; i += this.config.chunkSize - this.config.chunkOverlap) {
      result.push(text.slice(i, i + this.config.chunkSize));
    }
    return result;
  }

  /**
   * 策略 2: Semantic Chunking
   * 基于相邻句子的 embedding 相似度，在语义变化大的位置切分
   */
  private async semanticChunk(content: string, metadata?: Partial<ChunkMetadata>): Promise<Chunk[]> {
    // 1. 先按句子切分
    const sentences = this.splitSentences(content);
    if (sentences.length <= 3) {
      return this.recursiveChunk(content, metadata);
    }

    // 2. 计算每个句子的 embedding
    const embeddings = await Promise.all(
      sentences.map(s => embedText(s))
    );

    // 3. 计算相邻句子的 cosine distance
    const distances: number[] = [];
    for (let i = 0; i < embeddings.length - 1; i++) {
      const dist = 1 - this.cosineSimilarity(embeddings[i], embeddings[i + 1]);
      distances.push(dist);
    }

    // 4. 找到语义断裂点（distance > threshold 的位置）
    const breakpoints: number[] = [];
    const threshold = this.computeAdaptiveThreshold(distances);

    for (let i = 0; i < distances.length; i++) {
      if (distances[i] > threshold) {
        breakpoints.push(i + 1); // 在 sentence[i] 后面切分
      }
    }

    // 5. 按断裂点切分
    const chunks: string[] = [];
    let start = 0;
    for (const bp of breakpoints) {
      const chunk = sentences.slice(start, bp).join('');
      if (chunk.length >= this.config.minChunkSize) {
        chunks.push(chunk);
        start = bp;
      }
    }
    // 最后一段
    const lastChunk = sentences.slice(start).join('');
    if (lastChunk.length >= this.config.minChunkSize) {
      chunks.push(lastChunk);
    } else if (chunks.length > 0) {
      chunks[chunks.length - 1] += lastChunk;
    } else {
      chunks.push(lastChunk);
    }

    return this.createChunksWithOverlap(chunks, metadata);
  }

  /**
   * 策略 3: Hybrid Chunking
   * 先按结构标题粗切，再对每个大段做 semantic 细切
   */
  private async hybridChunk(content: string, metadata?: Partial<ChunkMetadata>): Promise<Chunk[]> {
    // Phase 1: 按结构标题粗切
    const sectionPattern = /(?=【[^】]{1,20}】)|(?=(?:^|\n)(?:一|二|三|四|五|六|七|八|九|十)[、.．])/gm;
    const sections = content.split(sectionPattern).filter(s => s.trim().length > 0);

    const allChunks: Chunk[] = [];

    for (const section of sections) {
      if (section.length <= this.config.chunkSize) {
        // 小段直接作为一个 chunk
        const chunk = this.createChunk(section.trim(), allChunks.length, metadata);
        allChunks.push(chunk);
      } else {
        // 大段做 recursive chunking（避免 semantic chunking 的高 API 成本）
        const subChunks = this.recursiveChunk(section, {
          ...metadata,
          sectionTitle: this.extractSectionTitle(section),
        });
        allChunks.push(...subChunks);
      }
    }

    return allChunks;
  }

  /**
   * 为 chunk 添加 overlap（前后重叠）
   */
  private createChunksWithOverlap(texts: string[], metadata?: Partial<ChunkMetadata>): Chunk[] {
    const chunks: Chunk[] = [];
    const overlap = this.config.chunkOverlap;

    for (let i = 0; i < texts.length; i++) {
      let content = texts[i];

      // 添加前向 overlap
      if (i > 0 && overlap > 0) {
        const prevText = texts[i - 1];
        const overlapText = prevText.slice(-overlap);
        content = overlapText + content;
      }

      // 添加后向 overlap
      if (i < texts.length - 1 && overlap > 0) {
        const nextText = texts[i + 1];
        const overlapText = nextText.slice(0, overlap);
        content = content + overlapText;
      }

      chunks.push(this.createChunk(content, i, {
        ...metadata,
        chunkIndex: i,
        totalChunks: texts.length,
        overlapPrev: i > 0,
        overlapNext: i < texts.length - 1,
      }));
    }

    return chunks;
  }

  /**
   * 创建 Chunk 对象
   */
  private createChunk(content: string, index: number, metadata?: Partial<ChunkMetadata>): Chunk {
    return {
      id: `chunk_${index}_${Date.now()}`,
      content: content.trim(),
      metadata: {
        chunkIndex: index,
        tokenCount: Math.ceil(content.length / 2), // 中文近似
        ...metadata,
      } as ChunkMetadata,
    };
  }

  /**
   * 计算自适应阈值（基于 percentile）
   */
  private computeAdaptiveThreshold(distances: number[]): number {
    if (distances.length === 0) return this.config.semanticThreshold;

    const sorted = [...distances].sort((a, b) => a - b);
    // 使用 75th percentile 作为阈值
    const idx = Math.floor(sorted.length * 0.75);
    const adaptiveThreshold = sorted[idx];

    // 取配置阈值和自适应阈值的较大值
    return Math.max(this.config.semanticThreshold, adaptiveThreshold);
  }

  /**
   * Cosine 相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 句子切分
   */
  private splitSentences(text: string): string[] {
    return text.split(/(?<=[。！？；\n])/).filter(s => s.trim().length > 0);
  }

  /**
   * 提取段落标题
   */
  private extractSectionTitle(section: string): string | undefined {
    const match = section.match(/^【([^】]{1,20})】/);
    return match ? match[1] : undefined;
  }
}
