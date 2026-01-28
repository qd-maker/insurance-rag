import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export interface QueryLog {
    timestamp: string;
    request_id: string;              // UUID 请求唯一标识
    query: string;
    product_matched: string | null;
    retrieval_strategy: string | null; // 检索策略
    cache_hit: boolean;              // 是否命中缓存
    retrieved_chunks: Array<{
        id: number;
        similarity: number;
        snippet: string;
    }>;
    top_k: number;
    duration_ms: number;
    embedding_ms: number;
    llm_ms: number;
    tokens_used: {
        prompt: number;
        completion: number;
    };
    should_refuse: boolean;
    refuse_reason: string | null;
    error_type: string | null;       // 错误类型
    error_message: string | null;    // 错误信息
}

export interface ErrorLog {
    timestamp: string;
    request_id: string;
    error_type: string;
    error_message: string;
    stack?: string;
    context?: Record<string, any>;
}

export class QueryLogger {
    private log: Partial<QueryLog> = {};
    private _requestId: string;

    constructor(requestId?: string) {
        this._requestId = requestId || randomUUID();
        this.log.timestamp = new Date().toISOString();
        this.log.request_id = this._requestId;
        this.log.cache_hit = false;
        this.log.retrieval_strategy = null;
        this.log.error_type = null;
        this.log.error_message = null;
    }

    get requestId(): string {
        return this._requestId;
    }

    setQuery(query: string) {
        this.log.query = query;
    }

    setProductMatched(productName: string | null) {
        this.log.product_matched = productName;
    }

    setRetrievalStrategy(strategy: string | null) {
        this.log.retrieval_strategy = strategy;
    }

    setCacheHit(hit: boolean) {
        this.log.cache_hit = hit;
    }

    setError(errorType: string, errorMessage: string) {
        this.log.error_type = errorType;
        this.log.error_message = errorMessage;
    }

    setRetrievedChunks(
        chunks: Array<{ id: number; similarity?: number; content: string | null }>
    ) {
        this.log.retrieved_chunks = chunks.map((c) => ({
            id: c.id,
            similarity: c.similarity || 0,
            snippet: (c.content || '').slice(0, 100), // 仅记录前100字
        }));
    }

    setTopK(topK: number) {
        this.log.top_k = topK;
    }

    setDuration(ms: number) {
        this.log.duration_ms = ms;
    }

    setEmbeddingDuration(ms: number) {
        this.log.embedding_ms = ms;
    }

    setLLMDuration(ms: number) {
        this.log.llm_ms = ms;
    }

    setTokensUsed(prompt: number, completion: number) {
        this.log.tokens_used = { prompt, completion };
    }

    setRefusal(shouldRefuse: boolean, reason: string | null = null) {
        this.log.should_refuse = shouldRefuse;
        this.log.refuse_reason = reason;
    }

    async save() {
        try {
            // 确保logs目录存在
            const logsDir = path.join(process.cwd(), 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }

            // 按日期分文件
            const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
            const logFile = path.join(logsDir, `query_${today}.jsonl`);

            // 追加写入（每行一条JSON）
            const logLine = JSON.stringify(this.log) + '\n';
            fs.appendFileSync(logFile, logLine, 'utf-8');
        } catch (error) {
            console.error('[Logger] Failed to save log:', error);
        }
    }

    getLog(): Partial<QueryLog> {
        return this.log;
    }
}

/**
 * 错误日志专项收集
 * 错误日志单独写入 error_YYYYMMDD.jsonl
 */
export async function logError(
    requestId: string,
    errorType: string,
    errorMessage: string,
    stack?: string,
    context?: Record<string, any>
): Promise<void> {
    try {
        const logsDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const errorLogFile = path.join(logsDir, `error_${today}.jsonl`);

        const errorLog: ErrorLog = {
            timestamp: new Date().toISOString(),
            request_id: requestId,
            error_type: errorType,
            error_message: errorMessage,
            stack,
            context,
        };

        const logLine = JSON.stringify(errorLog) + '\n';
        fs.appendFileSync(errorLogFile, logLine, 'utf-8');
    } catch (err) {
        console.error('[Logger] Failed to save error log:', err);
    }
}

/**
 * 生成请求 ID
 */
export function generateRequestId(): string {
    return randomUUID();
}
