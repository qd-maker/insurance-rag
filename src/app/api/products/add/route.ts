import { NextResponse } from 'next/server';
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

type StepStatus = 'pending' | 'running' | 'done' | 'error';

type ProductAddStep = {
    step: string;
    status: StepStatus;
    detail?: string;
};

type ProductAddResults = {
    productId?: number;
    clauseId?: number;
    isActive?: boolean;
    status?: 'draft';
    error?: string;
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
            response_format: { type: 'json_object' },
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
    const { name, content, clauses } = parsed.data;
    const trimmedName = name.trim();
    const trimmedContent = content.trim();

    // ============ 3. 环境检查 ============
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return NextResponse.json({ error: '缺少 Supabase 配置' }, { status: 500 });
    }

    if (!OPENAI_API_KEY) {
        return NextResponse.json({ error: '缺少 OpenAI API Key' }, { status: 500 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: OPENAI_BASE_URL });

    const steps: ProductAddStep[] = [
        { step: '校验产品内容', status: 'pending' },
        { step: 'AI 抽取产品描述', status: 'pending' },
        { step: '保存产品草稿', status: 'pending' },
        { step: '语义分段 + 生成向量', status: 'pending' },
        { step: '写入条款和向量', status: 'pending' },
        { step: '等待审核发布', status: 'pending' },
    ];

    const results: ProductAddResults = {};
    const operatorName = req.headers.get('X-Operator-Name') || 'admin';
    const operatorIp = req.headers.get('X-Forwarded-For') || req.headers.get('X-Real-IP') || 'unknown';

    try {
        // ============ Step 1: 校验产品内容 ============
        steps[0].status = 'running';
        steps[0].status = 'done';
        steps[0].detail = `已接收 ${trimmedContent.length} 字条款文本`;

        // ============ Step 2: AI 抽取描述 ============
        steps[1].status = 'running';

        const description = await extractDescription(openai, trimmedName, trimmedContent);
        steps[1].status = 'done';
        steps[1].detail = description ? `"${description.slice(0, 50)}..."` : '（使用默认描述）';

        // ============ Step 3: 保存产品草稿 ============
        steps[2].status = 'running';

        // 检查是否已存在
        const { data: existingProduct } = await supabase
            .from('products')
            .select('id')
            .ilike('name', trimmedName)
            .maybeSingle();

        let productId: number;
        const productPayload = {
            description: description || trimmedContent.slice(0, 200),
            is_active: false,
            created_by: operatorName,
        };

        if (existingProduct) {
            const { error: updateError } = await supabase
                .from('products')
                .update(productPayload)
                .eq('id', existingProduct.id);

            if (updateError) throw new Error(`更新产品失败: ${updateError.message}`);
            productId = existingProduct.id;
            steps[2].detail = `已提交为草稿修订，产品 ID: ${productId}`;
        } else {
            const { data: newProduct, error: insertError } = await supabase
                .from('products')
                .insert({
                    name: trimmedName,
                    ...productPayload,
                })
                .select('id')
                .single();

            if (insertError) throw new Error(`创建产品失败: ${insertError.message}`);
            productId = newProduct.id;
            steps[2].detail = `已新建草稿，产品 ID: ${productId}`;
        }

        results.productId = productId;
        results.isActive = false;
        results.status = 'draft';
        steps[2].status = 'done';

        // ============ Step 4: 语义分段 + 生成向量 ============
        steps[3].status = 'running';

        const sections = clauses?.length
            ? clauses.map((clause) => [clause.title, clause.content].filter(Boolean).join('\n').trim())
            : splitClausesBySection(trimmedContent, trimmedName);

        if (sections.length === 0) {
            throw new Error('未能从产品内容中提取有效条款');
        }

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
        if (!insertedClauses?.length) throw new Error('写入条款失败: 未返回已创建条款');
        results.clauseId = insertedClauses?.[0]?.id;
        steps[4].detail = `写入 ${insertedClauses?.length || 0} 条条款`;
        steps[4].status = 'done';

        // ============ Step 6: 清除旧缓存并等待发布 ============
        steps[5].status = 'running';
        let cacheDetail = '缓存表不存在或无旧缓存';
        try {
            const cacheKey = normalizeProductName(trimmedName);
            await supabase
                .from('search_cache')
                .delete()
                .eq('query_hash', cacheKey);
            cacheDetail = '已清除该产品缓存';
        } catch {
            cacheDetail = '缓存表不存在或无旧缓存';
        }

        // ============ Step 7: 写入审计日志 ============
        try {
            await supabase.from('product_audit_log').insert({
                product_id: productId,
                action: existingProduct ? 'SUBMIT_REVISION' : 'CREATE_DRAFT',
                operator: operatorName,
                operator_ip: operatorIp,
                before_snapshot: existingProduct ? { id: existingProduct.id } : null,
                after_snapshot: {
                    productId,
                    clauseId: results.clauseId,
                    name: trimmedName,
                    contentLength: trimmedContent.length,
                    description: description || null,
                    is_active: false,
                    status: 'draft',
                },
                notes: existingProduct ? '通过管理后台提交草稿修订' : '通过管理后台创建草稿',
            });
        } catch (auditErr: unknown) {
            console.warn('[Audit] 写入审计日志失败:', getErrorMessage(auditErr));
            // 审计失败不影响主流程
        }

        steps[5].status = 'done';
        steps[5].detail = `${cacheDetail}，发布后前台可检索`;

        // ============ 返回成功结果 ============
        return NextResponse.json({
            success: true,
            message: `产品 "${trimmedName}" 已保存为草稿并生成向量，发布后前台可见。`,
            steps,
            results,
        });

    } catch (error: unknown) {
        const message = getErrorMessage(error);
        // 标记当前失败的步骤
        const runningStep = steps.find(s => s.status === 'running');
        if (runningStep) {
            runningStep.status = 'error';
            runningStep.detail = message;
        }

        results.error = message;

        return NextResponse.json({
            success: false,
            message: `添加失败: ${message}`,
            steps,
            results,
        }, { status: 500 });
    }
}
