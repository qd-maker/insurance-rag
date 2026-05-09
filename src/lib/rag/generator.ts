/**
 * Streaming Generator - 流式结构化生成
 * 
 * 支持：
 * 1. SSE (Server-Sent Events) 流式输出
 * 2. Structured Output (JSON Schema 约束)
 * 3. 多种输出格式（产品卡片、对比表、问答）
 * 4. Token 使用追踪
 */

import OpenAI from 'openai';
import { ParsedQuery, ScoredChunk, GenerationResult, RAGStep } from './types';

export interface GeneratorConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  streaming: boolean;
}

const DEFAULT_CONFIG: GeneratorConfig = {
  model: 'gpt-4o-mini',
  temperature: 0.1,
  maxTokens: 4096,
  streaming: true,
};

// ========== Prompt 模板 ==========

const PRODUCT_SUMMARY_PROMPT = `你是一个保险信息抽取助手。请基于"条款上下文"提取并汇总该保险产品的关键信息。

**严格要求**：
1. 只能输出纯 JSON，不要任何多余文本或 Markdown。
2. 每个字段都必须标注来源条款ID（sourceClauseId），如果无法确定来源则填 null。
3. 条款ID格式为"条款ID#数字"，请提取其中的数字作为 sourceClauseId。
4. 严格使用以下结构，绝不编造：

{
  "productName": { "value": string, "sourceClauseId": number | null },
  "overview": { "value": string, "sourceClauseId": number | null },
  "coreCoverage": [{ "title": string, "value": string, "desc": string, "sourceClauseId": number | null }],
  "exclusions": [{ "value": string, "sourceClauseId": number | null }],
  "targetAudience": { "value": string, "sourceClauseId": number | null },
  "premiumInfo": { "value": string, "sourceClauseId": number | null },
  "waitingPeriod": { "value": string, "sourceClauseId": number | null },
  "renewalTerms": { "value": string, "sourceClauseId": number | null },
  "salesScript": string[],
  "highlights": string[],
  "rawTerms": string
}

**Fallback 规则**：
如果条款上下文中没有明确说明某个字段的信息：
- 对于 value 字段：填入 "[条款未说明]"
- 对于 sourceClauseId：填入 null
- 绝对禁止编造`;

const SPECIFIC_QA_PROMPT = `你是一个保险条款解读助手。基于提供的条款内容，精确回答用户的问题。

要求：
1. 输出 JSON 格式
2. 每个回答点标注来源条款 ID
3. 如果条款中没有相关信息，明确说明"条款未涉及此内容"
4. 不要编造

输出格式：
{
  "answer": { "value": string, "sourceClauseIds": number[] },
  "details": [{ "point": string, "sourceClauseId": number | null }],
  "relatedTerms": string,
  "confidence": "high" | "medium" | "low"
}`;

const COMPARISON_PROMPT = `你是一个保险产品对比分析助手。基于多个产品的条款内容，生成结构化对比。

输出格式：
{
  "products": [{ "name": string, "sourceClauseId": number | null }],
  "dimensions": [
    {
      "name": string,
      "values": [{ "productIndex": number, "value": string, "sourceClauseId": number | null }]
    }
  ],
  "recommendation": string,
  "highlights": [string]
}`;

export class StreamingGenerator {
  private openai: OpenAI;
  private config: GeneratorConfig;

  constructor(config: Partial<GeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }

  /**
   * 获取对应 intent 的 system prompt
   */
  private getSystemPrompt(intent: string): string {
    switch (intent) {
      case 'product_summary': return PRODUCT_SUMMARY_PROMPT;
      case 'specific_question': return SPECIFIC_QA_PROMPT;
      case 'comparison': return COMPARISON_PROMPT;
      default: return PRODUCT_SUMMARY_PROMPT;
    }
  }

  /**
   * 构建上下文字符串（带条款 ID 标注）
   */
  private buildContextString(chunks: ScoredChunk[], productNames?: Record<number, string>): string {
    const parts: string[] = [];
    for (const { chunk } of chunks) {
      const productId = chunk.metadata.productId;
      const productName = productId && productNames ? productNames[productId] : null;
      const header = productName
        ? `【产品】${productName}  条款ID#${chunk.id}`
        : `条款ID#${chunk.id}`;
      parts.push(`${header}\n${chunk.content}`);
    }
    return parts.join('\n\n---\n\n');
  }

  /**
   * 非流式生成（返回完整 JSON）
   */
  async generate(
    query: ParsedQuery,
    chunks: ScoredChunk[],
    context: string,
    productNames?: Record<number, string>
  ): Promise<{ result: GenerationResult; step: Omit<RAGStep, 'name' | 'type'> }> {
    const startTime = Date.now();
    const systemPrompt = this.getSystemPrompt(query.intent);
    const contextStr = context || this.buildContextString(chunks, productNames);

    if (!contextStr.trim()) {
      const content = {
        answer: { value: '未检索到足够的条款依据，无法基于当前知识库回答该问题。', sourceClauseIds: [] },
        details: [],
        relatedTerms: '',
        confidence: 'low',
        sources: [],
        clauseMap: {},
      };
      return {
        result: {
          content,
          tokensUsed: { prompt: 0, completion: 0 },
          model: this.config.model,
          latencyMs: Date.now() - startTime,
        },
        step: {
          startTime,
          endTime: Date.now(),
          input: { query: query.original, intent: query.intent, contextLength: 0 },
          output: { model: this.config.model, skipped: true, reason: 'empty_context' },
        },
      };
    }

    const userPrompt = `用户问题：\n${query.original}\n\n条款上下文：\n${contextStr}\n\n请输出严格符合上述要求的 JSON。`;

    const response = await this.openai.chat.completions.create({
      model: this.config.model,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim() || '{}';
    let content: unknown;
    try {
      content = JSON.parse(text);
    } catch {
      content = { _raw: text, _parseError: true };
    }

    const result: GenerationResult = {
      content,
      tokensUsed: {
        prompt: response.usage?.prompt_tokens || 0,
        completion: response.usage?.completion_tokens || 0,
      },
      model: this.config.model,
      latencyMs: Date.now() - startTime,
    };

    return {
      result,
      step: {
        startTime,
        endTime: Date.now(),
        input: { query: query.original, intent: query.intent, contextLength: contextStr.length },
        output: {
          model: this.config.model,
          tokensUsed: result.tokensUsed,
          latencyMs: result.latencyMs,
        },
      },
    };
  }

  /**
   * 流式生成 - 返回 ReadableStream (用于 SSE)
   */
  createStream(
    query: ParsedQuery,
    chunks: ScoredChunk[],
    context: string,
    productNames?: Record<number, string>
  ): ReadableStream<Uint8Array> {
    const systemPrompt = this.getSystemPrompt(query.intent);
    const contextStr = context || this.buildContextString(chunks, productNames);
    const userPrompt = `用户问题：\n${query.original}\n\n条款上下文：\n${contextStr}\n\n请输出严格符合上述要求的 JSON。`;

    const openai = this.openai;
    const model = this.config.model;
    const temperature = this.config.temperature;
    const maxTokens = this.config.maxTokens;

    const encoder = new TextEncoder();

    return new ReadableStream({
      async start(controller) {
        try {
          // 发送检索元数据
          const metaEvent = `data: ${JSON.stringify({
            type: 'metadata',
            retrievalStrategy: chunks.length > 0 ? 'hybrid_rerank' : 'no_results',
            chunkCount: chunks.length,
            intent: query.intent,
          })}\n\n`;
          controller.enqueue(encoder.encode(metaEvent));

          // 开始流式生成
          const stream = await openai.chat.completions.create({
            model,
            temperature,
            max_tokens: maxTokens,
            stream: true,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          });

          let fullContent = '';

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || '';
            if (delta) {
              fullContent += delta;
              const event = `data: ${JSON.stringify({ type: 'delta', content: delta })}\n\n`;
              controller.enqueue(encoder.encode(event));
            }
          }

          // 发送完成事件
          const doneEvent = `data: ${JSON.stringify({
            type: 'done',
            fullContent,
          })}\n\n`;
          controller.enqueue(encoder.encode(doneEvent));

          controller.close();
        } catch (error: unknown) {
          const errorEvent = `data: ${JSON.stringify({
            type: 'error',
            message: error instanceof Error ? error.message : 'Generation failed',
          })}\n\n`;
          controller.enqueue(encoder.encode(errorEvent));
          controller.close();
        }
      },
    });
  }
}
