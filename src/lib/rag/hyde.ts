/**
 * HyDE - Hypothetical Document Embeddings
 * 
 * 核心思想：先让 LLM 生成一个"假设文档"（即理想答案），
 * 再用这个假设文档去做向量检索，弥合 query 与 document 之间的语义鸿沟。
 * 
 * 论文：Precise Zero-Shot Dense Retrieval without Relevance Labels (Gao et al., 2022)
 * 
 * 效果：对于短 query（如"安心无忧医疗险"），直接 embedding 后检索效果不如
 *       先生成一段描述性文本再检索，因为 documents 通常是描述性的长文本。
 */

import OpenAI from 'openai';
import { embedText } from '../embeddings';
import { type RAGStep } from './types';

export interface HyDEConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  numHypotheses: number; // 生成几个假设文档（多个取平均 embedding）
}

const DEFAULT_HYDE_CONFIG: HyDEConfig = {
  model: 'gpt-4o-mini',
  temperature: 0.7, // 稍高温度增加多样性
  maxTokens: 256,
  numHypotheses: 1,
};

const HYDE_SYSTEM_PROMPT = `你是一个保险条款文档生成器。给定一个查询，请生成一段可能包含答案的保险条款文档片段。

要求：
1. 模拟真实保险条款的写作风格（正式、条目化）
2. 包含具体的数字、条件、限制等细节
3. 长度在 100-200 字之间
4. 不要解释你在做什么，直接输出条款内容

示例查询："安心无忧医疗险"
示例输出："【产品概述】安心无忧医疗险是一款针对个人和家庭的综合医疗保障产品，承保年龄为出生满28天至65周岁，保障期间为1年，可续保至80周岁。本产品涵盖住院医疗、门诊手术、特殊门诊等保障责任，年度保额最高可达400万元，免赔额为1万元..."`;

export class HyDERetriever {
  private openai: OpenAI;
  private config: HyDEConfig;

  constructor(config: Partial<HyDEConfig> = {}) {
    this.config = { ...DEFAULT_HYDE_CONFIG, ...config };
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }

  /**
   * 生成假设文档
   */
  async generateHypothesis(query: string): Promise<string[]> {
    const hypotheses: string[] = [];

    for (let i = 0; i < this.config.numHypotheses; i++) {
      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        messages: [
          { role: 'system', content: HYDE_SYSTEM_PROMPT },
          { role: 'user', content: `查询：${query}` },
        ],
      });

      const text = response.choices[0]?.message?.content?.trim();
      if (text) {
        hypotheses.push(text);
      }
    }

    return hypotheses;
  }

  /**
   * HyDE 增强的 Embedding
   * 将假设文档的 embedding 与原始 query 的 embedding 融合
   */
  async getHyDEEmbedding(query: string): Promise<{
    embedding: number[];
    hypothesis: string;
    step: Omit<RAGStep, 'name' | 'type'>;
  }> {
    const startTime = Date.now();

    // 1. 生成假设文档
    const hypotheses = await this.generateHypothesis(query);
    if (hypotheses.length === 0) {
      // Fallback: 直接用原始 query embedding
      const embedding = await embedText(query);
      return {
        embedding,
        hypothesis: query,
        step: {
          startTime,
          endTime: Date.now(),
          input: { query },
          output: { fallback: true },
        },
      };
    }

    // 2. 获取假设文档的 embedding
    const hydeEmbedding = await embedText(hypotheses[0]);

    // 3. 如果有多个假设文档，取平均
    if (hypotheses.length > 1) {
      const embeddings = await Promise.all(
        hypotheses.map(h => embedText(h))
      );
      // 平均融合
      for (let i = 0; i < hydeEmbedding.length; i++) {
        let sum = 0;
        for (const emb of embeddings) {
          sum += emb[i];
        }
        hydeEmbedding[i] = sum / embeddings.length;
      }
    }

    // 4. (可选) 与原始 query embedding 加权融合
    // alpha * query_emb + (1-alpha) * hyde_emb
    const ALPHA = 0.3; // 原始 query 权重
    const queryEmbedding = await embedText(query);
    const fusedEmbedding = hydeEmbedding.map((val, idx) =>
      ALPHA * queryEmbedding[idx] + (1 - ALPHA) * val
    );

    // 归一化
    const norm = Math.sqrt(fusedEmbedding.reduce((s, v) => s + v * v, 0));
    const normalizedEmbedding = fusedEmbedding.map(v => v / norm);

    return {
      embedding: normalizedEmbedding,
      hypothesis: hypotheses[0],
      step: {
        startTime,
        endTime: Date.now(),
        input: { query },
        output: {
          hypothesis: hypotheses[0],
          numHypotheses: hypotheses.length,
          alpha: ALPHA,
        },
      },
    };
  }
}
