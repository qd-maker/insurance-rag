/**
 * Context Compressor - 上下文压缩
 * 
 * 解决的问题：
 * 1. 检索到的 chunks 可能包含与 query 无关的噪声段落
 * 2. 多个 chunks 可能有重复内容
 * 3. 总 token 数超过 LLM context window 或增加成本
 * 
 * 策略：
 * 1. Extractive: 从每个 chunk 中只提取与 query 相关的句子
 * 2. Abstractive: 用 LLM 对 chunks 做摘要压缩
 * 3. Deduplication: 去除语义重复的 chunks
 */

import OpenAI from 'openai';
import { ScoredChunk, RAGStep } from './types';

export interface CompressorConfig {
  method: 'extractive' | 'abstractive' | 'hybrid';
  maxTokens: number;        // 压缩后最大 token 数
  maxCharsPerChunk: number; // 每个 chunk 最大字符数
  deduplication: boolean;   // 是否去重
  deduplicationThreshold: number; // 去重相似度阈值
}

const DEFAULT_CONFIG: CompressorConfig = {
  method: 'hybrid',
  maxTokens: 4000,
  maxCharsPerChunk: 800,
  deduplication: true,
  deduplicationThreshold: 0.85,
};

export class ContextCompressor {
  private config: CompressorConfig;
  private openai: OpenAI;

  constructor(config: Partial<CompressorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }

  /**
   * 压缩检索结果为紧凑的上下文
   */
  async compress(
    query: string,
    chunks: ScoredChunk[]
  ): Promise<{ context: string; step: Omit<RAGStep, 'name' | 'type'> }> {
    const startTime = Date.now();
    const originalChars = chunks.reduce((s, c) => s + c.chunk.content.length, 0);

    let processedChunks = chunks;

    // Step 1: 去重
    if (this.config.deduplication) {
      processedChunks = this.deduplicateChunks(processedChunks);
    }

    // Step 2: 按方法压缩
    let context: string;
    switch (this.config.method) {
      case 'extractive':
        context = this.extractiveCompress(query, processedChunks);
        break;
      case 'abstractive':
        context = await this.abstractiveCompress(query, processedChunks);
        break;
      case 'hybrid':
      default:
        // 先提取，如果仍然太长再摘要
        context = this.extractiveCompress(query, processedChunks);
        const estimatedTokens = Math.ceil(context.length / 2); // 中文约 1 char = 0.5 token
        if (estimatedTokens > this.config.maxTokens) {
          context = await this.abstractiveCompress(query, processedChunks);
        }
        break;
    }

    return {
      context,
      step: {
        startTime,
        endTime: Date.now(),
        input: {
          query,
          chunkCount: chunks.length,
          originalChars,
        },
        output: {
          method: this.config.method,
          compressedChars: context.length,
          compressionRatio: (context.length / originalChars).toFixed(2),
          afterDedup: processedChunks.length,
        },
      },
    };
  }

  /**
   * 去重：基于 Jaccard 相似度去除近似重复的 chunks
   */
  private deduplicateChunks(chunks: ScoredChunk[]): ScoredChunk[] {
    if (chunks.length <= 1) return chunks;

    const result: ScoredChunk[] = [chunks[0]];

    for (let i = 1; i < chunks.length; i++) {
      const candidate = chunks[i];
      let isDuplicate = false;

      for (const existing of result) {
        const similarity = this.jaccardSimilarity(
          candidate.chunk.content,
          existing.chunk.content
        );
        if (similarity >= this.config.deduplicationThreshold) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        result.push(candidate);
      }
    }

    return result;
  }

  /**
   * Jaccard 相似度（基于字符 bi-gram）
   */
  private jaccardSimilarity(a: string, b: string): number {
    const getBigrams = (s: string) => {
      const bigrams = new Set<string>();
      for (let i = 0; i < s.length - 1; i++) {
        bigrams.add(s.slice(i, i + 2));
      }
      return bigrams;
    };

    const setA = getBigrams(a);
    const setB = getBigrams(b);

    let intersection = 0;
    for (const gram of setA) {
      if (setB.has(gram)) intersection++;
    }

    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Extractive 压缩：只保留与 query 相关的句子
   */
  private extractiveCompress(query: string, chunks: ScoredChunk[]): string {
    const queryKeywords = this.extractKeywords(query);
    const parts: string[] = [];

    for (const chunk of chunks) {
      const content = chunk.chunk.content;
      const sentences = this.splitSentences(content);

      // 对每个句子计算与 query 的关键词重叠度
      const scoredSentences = sentences.map(sent => {
        const sentLower = sent.toLowerCase();
        let score = 0;
        for (const kw of queryKeywords) {
          if (sentLower.includes(kw.toLowerCase())) {
            score++;
          }
        }
        return { sent, score };
      });

      // 保留有关键词命中的句子 + 首句（通常是标题/概述）
      const relevant = scoredSentences.filter((s, idx) => s.score > 0 || idx === 0);
      const selected = relevant.length > 0 ? relevant : [scoredSentences[0]];

      const compressed = selected.map(s => s.sent).join('');
      if (compressed.length > this.config.maxCharsPerChunk) {
        parts.push(compressed.slice(0, this.config.maxCharsPerChunk) + '...');
      } else {
        parts.push(compressed);
      }
    }

    return parts.join('\n\n---\n\n');
  }

  /**
   * Abstractive 压缩：用 LLM 摘要
   */
  private async abstractiveCompress(query: string, chunks: ScoredChunk[]): Promise<string> {
    const rawContext = chunks.map(c => c.chunk.content).join('\n\n---\n\n');

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 1000,
        messages: [
          {
            role: 'system',
            content: `你是一个信息压缩器。将以下保险条款内容针对用户查询进行摘要压缩。
要求：
1. 只保留与查询直接相关的信息
2. 保留关键数字、条件、限制
3. 保留条款 ID 标注（如"条款ID#123"）
4. 输出压缩后的条款摘要，不要添加解释`,
          },
          {
            role: 'user',
            content: `查询：${query}\n\n原始条款内容：\n${rawContext.slice(0, 6000)}`,
          },
        ],
      });

      return response.choices[0]?.message?.content || rawContext.slice(0, 3000);
    } catch (error) {
      console.error('[ContextCompressor] Abstractive compression failed:', error);
      // Fallback to truncation
      return rawContext.slice(0, 4000);
    }
  }

  /**
   * 中文句子切分
   */
  private splitSentences(text: string): string[] {
    return text.split(/(?<=[。！？；\n])/).filter(s => s.trim().length > 0);
  }

  /**
   * 关键词提取
   */
  private extractKeywords(query: string): string[] {
    const stopWords = new Set(['的', '了', '是', '在', '和', '与', '或', '及', '等', '中', '请', '问']);
    const segments = query.split(/[\s，。！？、]+/).filter(s => s.length > 1 && !stopWords.has(s));
    return segments;
  }
}
