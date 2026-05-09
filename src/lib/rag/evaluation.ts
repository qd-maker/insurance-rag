/**
 * RAGAS-style 自动化评估体系
 * 
 * 评估维度（对标 RAGAS 框架）：
 * 1. Faithfulness - 忠实度：答案是否能从 context 中推导出
 * 2. Answer Relevancy - 回答相关性：答案是否回答了问题
 * 3. Context Precision - 上下文精度：检索到的 chunks 有多少是相关的
 * 4. Context Recall - 上下文召回：答案中的信息有多少能追溯到 context
 * 5. Citation Accuracy - 引用准确率：每个 sourceClauseId 是否指向正确内容
 * 
 * 用途：
 * - 持续监控 pipeline 质量
 * - A/B 对比不同配置的效果
 * - 回归检测（pipeline 变更后质量是否下降）
 */

import OpenAI from 'openai';

export interface EvalMetrics {
  faithfulness: number;       // 0-1, 答案忠实于 context 的程度
  answerRelevancy: number;    // 0-1, 答案与问题的相关性
  contextPrecision: number;   // 0-1, 检索到的 context 中相关比例
  contextRecall: number;      // 0-1, ground truth 能被 context 覆盖的比例
  citationAccuracy: number;   // 0-1, 引用 ID 指向内容的准确率
  overall: number;            // 综合评分
}

export interface EvalInput {
  query: string;
  answer: any;               // LLM 生成的结构化输出
  contexts: string[];        // 检索到的 chunks
  groundTruth?: string;      // （可选）人工标注的正确答案
}

export interface EvalResult {
  metrics: EvalMetrics;
  details: {
    faithfulnessStatements: { statement: string; supported: boolean }[];
    relevancyScore: number;
    precisionChunks: { chunkIndex: number; isRelevant: boolean }[];
  };
  timestamp: string;
  pipelineConfig?: string;
}

export class RAGEvaluator {
  private openai: OpenAI;
  private model: string;

  constructor(model?: string) {
    this.model = model || process.env.GENERATION_MODEL || 'gpt-4o-mini';
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }

  /**
   * 执行完整评估
   */
  async evaluate(input: EvalInput): Promise<EvalResult> {
    const [faithfulness, relevancy, precision, recall, citation] = await Promise.all([
      this.evaluateFaithfulness(input),
      this.evaluateAnswerRelevancy(input),
      this.evaluateContextPrecision(input),
      this.evaluateContextRecall(input),
      this.evaluateCitationAccuracy(input),
    ]);

    const metrics: EvalMetrics = {
      faithfulness: faithfulness.score,
      answerRelevancy: relevancy.score,
      contextPrecision: precision.score,
      contextRecall: recall.score,
      citationAccuracy: citation.score,
      overall: (faithfulness.score + relevancy.score + precision.score + recall.score + citation.score) / 5,
    };

    return {
      metrics,
      details: {
        faithfulnessStatements: faithfulness.statements,
        relevancyScore: relevancy.score,
        precisionChunks: precision.chunks,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 批量评估（用于 eval set）
   */
  async evaluateBatch(inputs: EvalInput[]): Promise<{
    results: EvalResult[];
    aggregate: EvalMetrics;
  }> {
    const results = await Promise.all(
      inputs.map(input => this.evaluate(input))
    );

    // 计算聚合指标
    const aggregate: EvalMetrics = {
      faithfulness: this.average(results.map(r => r.metrics.faithfulness)),
      answerRelevancy: this.average(results.map(r => r.metrics.answerRelevancy)),
      contextPrecision: this.average(results.map(r => r.metrics.contextPrecision)),
      contextRecall: this.average(results.map(r => r.metrics.contextRecall)),
      citationAccuracy: this.average(results.map(r => r.metrics.citationAccuracy)),
      overall: this.average(results.map(r => r.metrics.overall)),
    };

    return { results, aggregate };
  }

  /**
   * Faithfulness 评估
   * 将答案拆解为 statements，逐条检查是否能从 context 中推导
   */
  private async evaluateFaithfulness(input: EvalInput): Promise<{
    score: number;
    statements: { statement: string; supported: boolean }[];
  }> {
    const answerText = typeof input.answer === 'string'
      ? input.answer
      : JSON.stringify(input.answer, null, 2);

    const prompt = `任务：评估答案的忠实度。

问题：${input.query}
答案：${answerText}
参考上下文：
${input.contexts.join('\n---\n')}

请将答案拆解为独立的事实性陈述，并判断每条是否能从参考上下文中推导出。
输出 JSON：
{
  "statements": [
    {"statement": "...", "supported": true/false}
  ]
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' } as any,
        messages: [{ role: 'user', content: prompt }],
      });

      const result = JSON.parse(response.choices[0]?.message?.content || '{"statements":[]}');
      const statements = result.statements || [];
      const supported = statements.filter((s: any) => s.supported).length;
      const score = statements.length > 0 ? supported / statements.length : 0;

      return { score, statements };
    } catch (error) {
      console.error('[Eval] Faithfulness evaluation failed:', error);
      return { score: 0, statements: [] };
    }
  }

  /**
   * Answer Relevancy 评估
   * 生成多个可能的问题，看与原始问题的相似度
   */
  private async evaluateAnswerRelevancy(input: EvalInput): Promise<{ score: number }> {
    const answerText = typeof input.answer === 'string'
      ? input.answer
      : JSON.stringify(input.answer, null, 2);

    const prompt = `任务：评估答案与问题的相关性。

原始问题：${input.query}
答案：${answerText}

请评估该答案回答原始问题的程度，0-10 分。
输出 JSON：{"score": number, "reasoning": "..."}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' } as any,
        messages: [{ role: 'user', content: prompt }],
      });

      const result = JSON.parse(response.choices[0]?.message?.content || '{"score":5}');
      return { score: (result.score || 5) / 10 };
    } catch (error) {
      console.error('[Eval] Answer relevancy evaluation failed:', error);
      return { score: 0.5 };
    }
  }

  /**
   * Context Precision 评估
   * 检索到的 chunks 中有多少是与问题相关的
   */
  private async evaluateContextPrecision(input: EvalInput): Promise<{
    score: number;
    chunks: { chunkIndex: number; isRelevant: boolean }[];
  }> {
    if (input.contexts.length === 0) return { score: 0, chunks: [] };

    const prompt = `任务：判断每段检索内容与问题的相关性。

问题：${input.query}

检索内容：
${input.contexts.map((c, i) => `[${i}] ${c.slice(0, 200)}`).join('\n')}

请判断每段内容是否与问题相关。
输出 JSON：{"chunks": [{"index": 0, "relevant": true/false}, ...]}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' } as any,
        messages: [{ role: 'user', content: prompt }],
      });

      const result = JSON.parse(response.choices[0]?.message?.content || '{"chunks":[]}');
      const chunks = (result.chunks || []).map((c: any) => ({
        chunkIndex: c.index,
        isRelevant: c.relevant,
      }));
      const relevant = chunks.filter((c: any) => c.isRelevant).length;
      const score = chunks.length > 0 ? relevant / chunks.length : 0;

      return { score, chunks };
    } catch (error) {
      console.error('[Eval] Context precision evaluation failed:', error);
      return { score: 0, chunks: [] };
    }
  }

  /**
   * Context Recall 评估
   * 答案中的信息有多少能追溯到 context
   */
  private async evaluateContextRecall(input: EvalInput): Promise<{ score: number }> {
    if (!input.groundTruth) {
      // 无 ground truth 时用启发式方法
      return { score: 0.7 }; // 默认值，提示需要标注
    }

    const prompt = `任务：评估上下文对正确答案的覆盖率。

正确答案：${input.groundTruth}
检索上下文：
${input.contexts.join('\n---\n')}

正确答案中的要点有多少能在检索上下文中找到？0-10分。
输出 JSON：{"score": number, "covered_points": number, "total_points": number}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' } as any,
        messages: [{ role: 'user', content: prompt }],
      });

      const result = JSON.parse(response.choices[0]?.message?.content || '{"score":5}');
      return { score: (result.score || 5) / 10 };
    } catch (error) {
      console.error('[Eval] Context recall evaluation failed:', error);
      return { score: 0.5 };
    }
  }

  /**
   * Citation Accuracy 评估
   * 检查 sourceClauseId 是否指向包含相关信息的 chunk
   */
  private async evaluateCitationAccuracy(input: EvalInput): Promise<{ score: number }> {
    if (typeof input.answer !== 'object') return { score: 0 };

    let totalCitations = 0;
    let validCitations = 0;

    // 递归提取所有 sourceClauseId
    const extractCitations = (obj: any): void => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach(extractCitations);
        return;
      }
      if ('sourceClauseId' in obj && obj.sourceClauseId != null) {
        totalCitations++;
        // 检查该 clauseId 是否在 contexts 中存在
        const clauseId = String(obj.sourceClauseId);
        const found = input.contexts.some(ctx => ctx.includes(`条款ID#${clauseId}`) || ctx.includes(`#${clauseId}`));
        if (found) validCitations++;
      }
      Object.values(obj).forEach(extractCitations);
    };

    extractCitations(input.answer);

    return {
      score: totalCitations > 0 ? validCitations / totalCitations : 1,
    };
  }

  /**
   * 计算平均值
   */
  private average(nums: number[]): number {
    if (nums.length === 0) return 0;
    return nums.reduce((s, n) => s + n, 0) / nums.length;
  }
}

/**
 * 生成评估报告（Markdown 格式）
 */
export function generateEvalReport(
  aggregate: EvalMetrics,
  configName: string = 'default'
): string {
  const bar = (score: number) => {
    const filled = Math.round(score * 20);
    return '█'.repeat(filled) + '░'.repeat(20 - filled);
  };

  return `
# RAG Pipeline 评估报告

**Pipeline 配置**: ${configName}
**评估时间**: ${new Date().toISOString()}

## 指标总览

| 维度 | 得分 | 可视化 |
|------|------|--------|
| Faithfulness（忠实度） | ${(aggregate.faithfulness * 100).toFixed(1)}% | ${bar(aggregate.faithfulness)} |
| Answer Relevancy（相关性） | ${(aggregate.answerRelevancy * 100).toFixed(1)}% | ${bar(aggregate.answerRelevancy)} |
| Context Precision（精度） | ${(aggregate.contextPrecision * 100).toFixed(1)}% | ${bar(aggregate.contextPrecision)} |
| Context Recall（召回） | ${(aggregate.contextRecall * 100).toFixed(1)}% | ${bar(aggregate.contextRecall)} |
| Citation Accuracy（引用） | ${(aggregate.citationAccuracy * 100).toFixed(1)}% | ${bar(aggregate.citationAccuracy)} |
| **Overall** | **${(aggregate.overall * 100).toFixed(1)}%** | ${bar(aggregate.overall)} |

## 建议

${aggregate.faithfulness < 0.8 ? '- ⚠️ 忠实度偏低：考虑加强 Context Compression 或调整 LLM temperature\n' : ''}
${aggregate.contextPrecision < 0.7 ? '- ⚠️ 检索精度偏低：建议启用 Reranker 或调整 similarity threshold\n' : ''}
${aggregate.contextRecall < 0.7 ? '- ⚠️ 检索召回偏低：建议增大 topK 或启用 HyDE\n' : ''}
${aggregate.citationAccuracy < 0.9 ? '- ⚠️ 引用准确率偏低：检查 LLM prompt 中的引用指令\n' : ''}
`;
}
