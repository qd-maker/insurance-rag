import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { embedText } from '@/lib/embeddings';
import { ProductAddRequestSchema, parseAndValidate } from '@/lib/schemas';
import { splitClausesBySection } from '@/lib/chunking';
import { normalizeProductName } from '@/lib/retrieval';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const GENERATION_MODEL = process.env.GENERATION_MODEL || 'gpt-4o-mini';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

// 统一名称归一化
function normalize(s: string) {
    return s
        .toLowerCase()
        .normalize('NFKC')
        .replace(/[\s\u3000]/g, '')
        .replace(/[()（）［］【】\[\]·•．・。、，,._/:\'\'\"\""-]+/g, '');
}

// 利用 LLM 从原始内容抽取 description
async function extractDescription(openai: OpenAI, name: string, content: string): Promise<string> {
    const sys = `你是保险结构化抽取助手。输出严格 JSON（application/json），不要多余文本。`;
    const user = `请从以下产品原始描述中抽取：
- description: 对产品的简短概述（不超过80字，避免营销用语）

产品名：${name}
原始内容：
${content}

以如下 JSON 返回：{ "description": string }`;

    try {
        const chat = await openai.chat.completions.create({
            model: GENERATION_MODEL,
            temperature: 0.2,
            response_format: { type: 'json_object' } as any,
            messages: [
                { role: 'system', content: sys },
                { role: 'user', content: user },
            ],
        });
        const txt = chat.choices?.[0]?.message?.content?.trim() || '{}';
        const j = JSON.parse(txt);
        return (j?.description ?? '').toString().trim();
    } catch {
        return '';
    }
}

export async function POST(req: Request) {
    // ============ 1. 验证 Token ============
    const authHeader = req.headers.get('Authorization');
    const providedToken = authHeader?.replace('Bearer ', '');

    if (!ADMIN_TOKEN) {
        return NextResponse.json({ error: '服务器未配置管理员 Token' }, { status: 500 });
    }

    if (providedToken !== ADMIN_TOKEN) {
        return NextResponse.json({ error: '认证失败：Token 无效' }, { status: 401 });
    }

    // ============ 2. Schema 校验 ============
    const parsed = await parseAndValidate(req, ProductAddRequestSchema);
    if (!parsed.success) {
        return parsed.response;
    }
    const { name, content } = parsed.data;

    // ============ 3. 环境检查 ============
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return NextResponse.json({ error: '缺少 Supabase 配置' }, { status: 500 });
    }

    if (!OPENAI_API_KEY) {
        return NextResponse.json({ error: '缺少 OpenAI API Key' }, { status: 500 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: OPENAI_BASE_URL });

    const steps: { step: string; status: 'pending' | 'running' | 'done' | 'error'; detail?: string }[] = [
        { step: '保存到 seedData.ts', status: 'pending' },
        { step: 'AI 抽取产品描述', status: 'pending' },
        { step: '写入产品数据库', status: 'pending' },
        { step: '语义分段 + 生成向量', status: 'pending' },
        { step: '写入条款和向量', status: 'pending' },
        { step: '清除旧缓存', status: 'pending' },
    ];

    const results: { productId?: number; clauseId?: number; error?: string } = {};

    try {
        // ============ Step 1: 保存到 seedData.ts ============
        steps[0].status = 'running';

        const seedDataPath = path.join(process.cwd(), 'scripts', 'seedData.ts');
        let fileContent: string;

        try {
            fileContent = fs.readFileSync(seedDataPath, 'utf-8');
        } catch {
            throw new Error('无法读取 seedData 文件');
        }

        const escapedName = name.trim().replace(/'/g, "\\'").replace(/\\/g, '\\\\');
        const escapedContent = content.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

        const newProductEntry = `
  // 🆕 通过网页添加 - ${new Date().toLocaleString('zh-CN')}
  {
    name: '${escapedName}',
    content:
      '${escapedContent}',
  },`;

        const insertPattern = /(\];\s*)$/;
        if (!insertPattern.test(fileContent)) {
            throw new Error('seedData.ts 格式异常');
        }

        const updatedContent = fileContent.replace(insertPattern, `${newProductEntry}\n$1`);
        fs.writeFileSync(seedDataPath, updatedContent, 'utf-8');

        steps[0].status = 'done';

        // ============ Step 2: AI 抽取描述 ============
        steps[1].status = 'running';

        const description = await extractDescription(openai, name.trim(), content.trim());
        steps[1].status = 'done';
        steps[1].detail = description ? `"${description.slice(0, 50)}..."` : '（使用默认描述）';

        // ============ Step 3: 写入产品数据库 ============
        steps[2].status = 'running';

        const normalizedName = normalize(name.trim());

        // 检查是否已存在
        const { data: existingProduct } = await supabase
            .from('products')
            .select('id')
            .ilike('name', name.trim())
            .single();

        let productId: number;

        if (existingProduct) {
            // 更新现有产品
            const { error: updateError } = await supabase
                .from('products')
                .update({ description: description || content.trim().slice(0, 200) })
                .eq('id', existingProduct.id);

            if (updateError) throw new Error(`更新产品失败: ${updateError.message}`);
            productId = existingProduct.id;
            steps[2].detail = `更新产品 ID: ${productId}`;
        } else {
            // 创建新产品
            const { data: newProduct, error: insertError } = await supabase
                .from('products')
                .insert({ name: name.trim(), description: description || content.trim().slice(0, 200) })
                .select('id')
                .single();

            if (insertError) throw new Error(`创建产品失败: ${insertError.message}`);
            productId = newProduct.id;
            steps[2].detail = `新建产品 ID: ${productId}`;
        }

        results.productId = productId;
        steps[2].status = 'done';

        // ============ Step 4: 语义分段 + 生成向量 ============
        steps[3].status = 'running';

        // 按【标题】切分为多条独立条款
        const sections = splitClausesBySection(content.trim(), name.trim());
        const embeddings: number[][] = [];
        for (const section of sections) {
            const emb = await embedText(section, { model: EMBEDDING_MODEL });
            embeddings.push(emb);
        }
        steps[3].status = 'done';
        steps[3].detail = `${sections.length} 段, 向量维度: ${embeddings[0]?.length || 0}`;

        // ============ Step 5: 写入条款和向量 ============
        steps[4].status = 'running';

        // 先删除该产品的所有旧条款（全量替换，避免碎片残留）
        const { error: deleteError } = await supabase
            .from('clauses')
            .delete()
            .eq('product_id', productId);
        if (deleteError) throw new Error(`清理旧条款失败: ${deleteError.message}`);

        // 批量插入新条款
        const clauseRows = sections.map((section, i) => ({
            product_id: productId,
            content: section,
            embedding: embeddings[i],
        }));

        const { data: insertedClauses, error: insertError } = await supabase
            .from('clauses')
            .insert(clauseRows)
            .select('id');

        if (insertError) throw new Error(`写入条款失败: ${insertError.message}`);
        results.clauseId = insertedClauses?.[0]?.id;
        steps[4].detail = `写入 ${insertedClauses?.length || 0} 条条款`;
        steps[4].status = 'done';

        // ============ Step 6: 清除旧缓存 ============
        steps[5].status = 'running';
        try {
            const cacheKey = normalizeProductName(name.trim());
            await supabase
                .from('search_cache')
                .delete()
                .eq('query_hash', cacheKey);
            steps[5].status = 'done';
            steps[5].detail = '已清除该产品缓存';
        } catch {
            steps[5].status = 'done';
            steps[5].detail = '缓存表不存在或无旧缓存';
        }

        // ============ Step 6: 写入审计日志 ============
        const operatorName = req.headers.get('X-Operator-Name') || 'admin';
        const operatorIp = req.headers.get('X-Forwarded-For') || req.headers.get('X-Real-IP') || 'unknown';

        try {
            await supabase.from('product_audit_log').insert({
                product_id: productId,
                action: existingProduct ? 'UPDATE' : 'CREATE',
                operator: operatorName,
                operator_ip: operatorIp,
                before_snapshot: existingProduct ? { id: existingProduct.id } : null,
                after_snapshot: {
                    productId,
                    clauseId: results.clauseId,
                    name: name.trim(),
                    contentLength: content.trim().length,
                    description: description || null,
                },
                notes: `通过管理后台添加`,
            });
        } catch (auditErr: any) {
            console.warn('[Audit] 写入审计日志失败:', auditErr.message);
            // 审计失败不影响主流程
        }

        // ============ 返回成功结果 ============
        return NextResponse.json({
            success: true,
            message: `产品 "${name.trim()}" 已成功添加并生成向量！`,
            steps,
            results,
        });

    } catch (error: any) {
        // 标记当前失败的步骤
        const runningStep = steps.find(s => s.status === 'running');
        if (runningStep) {
            runningStep.status = 'error';
            runningStep.detail = error.message;
        }

        results.error = error.message;

        return NextResponse.json({
            success: false,
            message: `添加失败: ${error.message}`,
            steps,
            results,
        }, { status: 500 });
    }
}
