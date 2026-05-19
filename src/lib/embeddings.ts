/**
 * 多模态向量嵌入工具
 * 适配中转站的多模态 Embedding API
 * 文档: https://gpt-best.apifox.cn/api-139393496
 */

export interface EmbeddingOptions {
    model?: string;
    normalized?: boolean;
    embeddingType?: string;
}

export interface MultimodalEmbeddingRequest {
    model: string;
    normalized: boolean;
    embedding_type: string;
    input: Array<{
        text: string;
        image: string;
    }>;
}

export interface EmbeddingResponse {
    object: string;
    data: Array<{
        object: string;
        embedding: number[];
        index: number;
    }>;
    model: string;
    usage: {
        prompt_tokens: number;
        total_tokens: number;
    };
}

const EMBEDDING_TIMEOUT_MS = Number(process.env.EMBEDDING_TIMEOUT_MS || '15000');
const EMBEDDING_MAX_RETRIES = Number(process.env.EMBEDDING_MAX_RETRIES || '1');
const EMBEDDING_STRICT_DIM = process.env.EMBEDDING_STRICT_DIM === 'true';

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('aborted')) return true;
    if (msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('enotfound')) return true;
    if (msg.includes('fetch failed') || msg.includes('network')) return true;
    const statusMatch = msg.match(/\((\d{3})\)/);
    if (statusMatch) {
        const status = Number(statusMatch[1]);
        return status === 408 || status === 429 || status >= 500;
    }
    return false;
}

/**
 * 为文本生成向量嵌入
 * @param text 输入文本
 * @param options 配置选项
 * @returns 嵌入向量数组
 */
export async function embedText(
    text: string,
    options: EmbeddingOptions = {}
): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_BASE_URL || 'https://yunwu.ai/v1';
    const model = options.model || process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

    if (!apiKey) {
        throw new Error('缺少 OPENAI_API_KEY 环境变量');
    }

    const requestBody = { model, input: text };

    let lastError: unknown;
    for (let attempt = 0; attempt <= EMBEDDING_MAX_RETRIES; attempt++) {
        try {
            return await embedTextOnce(baseURL, apiKey, requestBody);
        } catch (error) {
            lastError = error;
            if (attempt < EMBEDDING_MAX_RETRIES && isRetryableError(error)) {
                const backoffMs = 800 * Math.pow(2, attempt);
                console.warn(`[Embedding] 调用失败 (attempt ${attempt + 1}/${EMBEDDING_MAX_RETRIES + 1})，${backoffMs}ms 后重试: ${error instanceof Error ? error.message : error}`);
                await sleep(backoffMs);
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}

async function embedTextOnce(
    baseURL: string,
    apiKey: string,
    requestBody: { model: string; input: string }
): Promise<number[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

    try {
        const response = await fetch(`${baseURL}/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(
                `Embedding API 调用失败 (${response.status}): ${errorText.slice(0, 500)}`
            );
        }

        const data: EmbeddingResponse = await response.json();

        if (!data.data || data.data.length === 0) {
            throw new Error('Embedding API 返回空数据');
        }

        const embedding = data.data[0].embedding;

        const expectedDim = Number(process.env.EMBEDDING_DIM || '3072');
        if (embedding.length !== expectedDim) {
            const msg = `Embedding 维度不匹配: 期望 ${expectedDim}, 实际 ${embedding.length}`;
            if (EMBEDDING_STRICT_DIM) {
                throw new Error(msg);
            }
            console.warn(`⚠️ ${msg}`);
        }

        return embedding;
    } catch (error: unknown) {
        if (error instanceof Error) {
            if (error.name === 'AbortError') {
                throw new Error(`Embedding API 调用超时 (${EMBEDDING_TIMEOUT_MS}ms)`);
            }
            if (error.message.toLowerCase().includes('fetch')) {
                throw new Error(`Embedding 网络请求失败: ${error.message}`);
            }
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * 批量生成向量嵌入（为未来扩展预留）
 * @param texts 文本数组
 * @param options 配置选项
 * @returns 嵌入向量数组的数组
 */
export async function embedTexts(
    texts: string[],
    options: EmbeddingOptions = {}
): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
        const embedding = await embedText(text, options);
        embeddings.push(embedding);
    }
    return embeddings;
}
