/**
 * RAG Tracing - 全链路可观测
 * 
 * 集成 LangFuse（开源 LLM 可观测平台）
 * 记录 RAG Pipeline 每一步的输入/输出/延迟/Token 消耗
 * 
 * 使用方式：
 * - 生产环境：上报到 LangFuse Cloud 或自托管实例
 * - 开发环境：输出到控制台 + 本地日志文件
 * 
 * 环境变量：
 * - LANGFUSE_PUBLIC_KEY
 * - LANGFUSE_SECRET_KEY
 * - LANGFUSE_HOST (默认 https://cloud.langfuse.com)
 */

import { RAGTrace, RAGStep } from './types';

export interface TracingConfig {
  enabled: boolean;
  provider: 'langfuse' | 'console' | 'both';
  langfuseHost?: string;
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
}

const DEFAULT_TRACING_CONFIG: TracingConfig = {
  enabled: true,
  provider: 'console',
};

export class RAGTracer {
  private config: TracingConfig;
  private langfuseClient: any | null = null;

  constructor(config: Partial<TracingConfig> = {}) {
    this.config = { ...DEFAULT_TRACING_CONFIG, ...config };
    this.initLangfuse();
  }

  /**
   * 初始化 LangFuse 客户端
   */
  private async initLangfuse() {
    const publicKey = this.config.langfusePublicKey || process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = this.config.langfuseSecretKey || process.env.LANGFUSE_SECRET_KEY;
    const host = this.config.langfuseHost || process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com';

    if (publicKey && secretKey) {
      try {
        // Dynamic import to avoid bundling issues
        const { Langfuse } = await import('langfuse');
        this.langfuseClient = new Langfuse({
          publicKey,
          secretKey,
          baseUrl: host,
        });
        this.config.provider = 'langfuse';
        console.log('[Tracing] LangFuse initialized successfully');
      } catch (err) {
        console.warn('[Tracing] LangFuse not available, falling back to console');
        this.config.provider = 'console';
      }
    }
  }

  /**
   * 上报完整 Trace
   */
  async reportTrace(trace: RAGTrace): Promise<void> {
    if (!this.config.enabled) return;

    switch (this.config.provider) {
      case 'langfuse':
        await this.reportToLangfuse(trace);
        break;
      case 'console':
        this.reportToConsole(trace);
        break;
      case 'both':
        this.reportToConsole(trace);
        await this.reportToLangfuse(trace);
        break;
    }
  }

  /**
   * 上报到 LangFuse
   */
  private async reportToLangfuse(trace: RAGTrace): Promise<void> {
    if (!this.langfuseClient) return;

    try {
      const langfuseTrace = this.langfuseClient.trace({
        id: trace.traceId,
        name: 'rag-pipeline',
        metadata: {
          sessionId: trace.sessionId,
          totalSteps: trace.steps.length,
          error: trace.error,
        },
      });

      // 记录每一步为 span
      for (const step of trace.steps) {
        const span = langfuseTrace.span({
          name: step.name,
          startTime: new Date(step.startTime),
          endTime: new Date(step.endTime),
          metadata: step.metadata,
          input: step.input,
          output: step.output,
        });

        // 如果是 LLM 生成步骤，记录为 generation
        if (step.type === 'generation') {
          langfuseTrace.generation({
            name: step.name,
            model: step.output?.model,
            input: step.input,
            output: step.output,
            usage: {
              promptTokens: step.output?.tokensUsed?.prompt,
              completionTokens: step.output?.tokensUsed?.completion,
            },
            startTime: new Date(step.startTime),
            endTime: new Date(step.endTime),
          });
        }
      }

      await this.langfuseClient.flush();
    } catch (error) {
      console.error('[Tracing] LangFuse report failed:', error);
    }
  }

  /**
   * 输出到控制台（开发环境）
   */
  private reportToConsole(trace: RAGTrace): void {
    const totalMs = (trace.endTime || Date.now()) - trace.startTime;
    console.log('\n' + '='.repeat(60));
    console.log(`📊 RAG Trace: ${trace.traceId}`);
    console.log(`⏱️  Total: ${totalMs}ms | Steps: ${trace.steps.length}`);
    if (trace.error) console.log(`❌ Error: ${trace.error}`);
    console.log('-'.repeat(60));

    for (const step of trace.steps) {
      const stepMs = step.endTime - step.startTime;
      const icon = this.getStepIcon(step.type);
      console.log(`  ${icon} ${step.name} (${stepMs}ms)`);

      // 简要输出关键信息
      if (step.type === 'routing') {
        console.log(`     → Intent: ${step.output?.intent}, Strategy: ${step.output?.strategy}`);
      } else if (step.type === 'retrieval') {
        console.log(`     → Chunks: ${step.output?.fusedCount || step.output?.chunkCount || '?'}`);
      } else if (step.type === 'rerank') {
        console.log(`     → TopK: ${step.output?.resultCount}, TopScore: ${step.output?.topScore?.toFixed(3)}`);
      } else if (step.type === 'generation') {
        console.log(`     → Tokens: ${step.output?.tokensUsed?.prompt}+${step.output?.tokensUsed?.completion}`);
      }
    }

    console.log('='.repeat(60) + '\n');
  }

  /**
   * 获取步骤图标
   */
  private getStepIcon(type: string): string {
    const icons: Record<string, string> = {
      query_parse: '🔍',
      routing: '🗺️',
      hyde: '💭',
      retrieval: '📚',
      rerank: '🎯',
      compression: '🗜️',
      generation: '✨',
    };
    return icons[type] || '▶️';
  }

  /**
   * 获取 trace 汇总统计（用于 dashboard 展示）
   */
  static summarizeTrace(trace: RAGTrace): Record<string, any> {
    const totalMs = (trace.endTime || Date.now()) - trace.startTime;
    const stepSummary: Record<string, number> = {};

    for (const step of trace.steps) {
      stepSummary[step.name] = step.endTime - step.startTime;
    }

    return {
      traceId: trace.traceId,
      totalMs,
      stepCount: trace.steps.length,
      stepLatencies: stepSummary,
      hasError: !!trace.error,
    };
  }
}
