import fs from 'fs';
import path from 'path';

export interface QueryLog {
    timestamp: string;
    query: string;
    product_matched: string | null;
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
}

export class QueryLogger {
    private log: Partial<QueryLog> = {};

    constructor() {
        this.log.timestamp = new Date().toISOString();
    }

    setQuery(query: string) {
        this.log.query = query;
    }

    setProductMatched(productName: string | null) {
        this.log.product_matched = productName;
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
}
