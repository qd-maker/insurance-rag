/**
 * API 模型调用测试脚本
 * 测试 EMBEDDING_MODEL 和 GENERATION_MODEL 是否可以正常调用
 */

import 'dotenv/config';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-large';
const GENERATION_MODEL = process.env.GENERATION_MODEL || 'gpt-4o-mini';
const EMBEDDING_DIM = process.env.EMBEDDING_DIM || '3072';

console.log('='.repeat(50));
console.log('🔧 API 模型调用测试');
console.log('='.repeat(50));
console.log('');
console.log('📋 当前配置:');
console.log(`  OPENAI_BASE_URL: ${OPENAI_BASE_URL}`);
console.log(`  EMBEDDING_MODEL: ${EMBEDDING_MODEL}`);
console.log(`  EMBEDDING_DIM: ${EMBEDDING_DIM}`);
console.log(`  GENERATION_MODEL: ${GENERATION_MODEL}`);
console.log('');

async function testEmbedding() {
    console.log('🧪 测试 Embedding API...');
    const startTime = Date.now();

    try {
        const response = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: EMBEDDING_MODEL,
                input: '这是一个测试文本',
            }),
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

        if (!response.ok) {
            const errorText = await response.text();
            console.log(`❌ Embedding 失败 (${response.status}): ${errorText}`);
            console.log(`   耗时: ${elapsed}s`);
            return false;
        }

        const data = await response.json();
        const dim = data.data?.[0]?.embedding?.length || 0;

        console.log(`✅ Embedding 成功!`);
        console.log(`   模型: ${data.model}`);
        console.log(`   维度: ${dim}`);
        console.log(`   耗时: ${elapsed}s`);

        if (dim !== Number(EMBEDDING_DIM)) {
            console.log(`⚠️  警告: 维度不匹配 (期望 ${EMBEDDING_DIM}, 实际 ${dim})`);
        }

        return true;
    } catch (error: any) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`❌ Embedding 错误: ${error.message}`);
        console.log(`   耗时: ${elapsed}s`);
        return false;
    }
}

async function testGeneration() {
    console.log('');
    console.log('🧪 测试 Generation API...');
    const startTime = Date.now();

    try {
        const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: GENERATION_MODEL,
                messages: [
                    { role: 'user', content: '请用一句话回答：1+1等于几？' }
                ],
                max_tokens: 50,
            }),
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

        if (!response.ok) {
            const errorText = await response.text();
            console.log(`❌ Generation 失败 (${response.status}): ${errorText}`);
            console.log(`   耗时: ${elapsed}s`);
            return false;
        }

        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content || '';

        console.log(`✅ Generation 成功!`);
        console.log(`   模型: ${data.model}`);
        console.log(`   回复: ${reply.slice(0, 100)}`);
        console.log(`   耗时: ${elapsed}s`);

        return true;
    } catch (error: any) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`❌ Generation 错误: ${error.message}`);
        console.log(`   耗时: ${elapsed}s`);
        return false;
    }
}

async function main() {
    if (!OPENAI_API_KEY) {
        console.log('❌ 错误: 缺少 OPENAI_API_KEY 环境变量');
        process.exit(1);
    }

    const embeddingOk = await testEmbedding();
    const generationOk = await testGeneration();

    console.log('');
    console.log('='.repeat(50));
    console.log('📊 测试结果汇总:');
    console.log(`  Embedding (${EMBEDDING_MODEL}): ${embeddingOk ? '✅ 通过' : '❌ 失败'}`);
    console.log(`  Generation (${GENERATION_MODEL}): ${generationOk ? '✅ 通过' : '❌ 失败'}`);
    console.log('='.repeat(50));

    if (!embeddingOk || !generationOk) {
        process.exit(1);
    }
}

main();
