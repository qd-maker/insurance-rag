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
    const baseURL = process.env.OPENAI_BASE_URL || 'https://api.bltcy.ai/v1';
    const model = options.model || process.env.EMBEDDING_MODEL || 'qwen3-embedding-4b';

    if (!apiKey) {
        throw new Error('缺少 OPENAI_API_KEY 环境变量');
    }

    // 使用标准 OpenAI Embedding API 格式
    const requestBody = {
        model,
        input: text
    };

    try {
        const response = await fetch(`${baseURL}/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(
                `Embedding API 调用失败 (${response.status}): ${errorText}`
            );
        }

        const data: EmbeddingResponse = await response.json();

        if (!data.data || data.data.length === 0) {
            throw new Error('Embedding API 返回空数据');
        }

        const embedding = data.data[0].embedding;

        // 维度检查（可选，用于调试）
        const expectedDim = Number(process.env.EMBEDDING_DIM || '1024');
        if (embedding.length !== expectedDim) {
            console.warn(
                `⚠️ Embedding 维度不匹配: 期望 ${expectedDim}, 实际 ${embedding.length}`
            );
        }

        return embedding;
    } catch (error: any) {
        // 增强错误信息
        if (error.message?.includes('fetch')) {
            throw new Error(`网络请求失败: ${error.message}`);
        }
        throw error;
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
    // 简单实现：逐个调用
    // TODO: 优化为单次批量请求（需确认 API 是否支持）
    const embeddings: number[][] = [];
    for (const text of texts) {
        const embedding = await embedText(text, options);
        embeddings.push(embedding);
    }
    return embeddings;
}
