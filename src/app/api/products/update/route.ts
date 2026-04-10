import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { embedText } from '@/lib/embeddings';
import { splitClausesBySection } from '@/lib/chunking';
import { normalizeProductName } from '@/lib/retrieval';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

export async function POST(req: Request) {
    // 验证 Token
    const authHeader = req.headers.get('Authorization');
    const providedToken = authHeader?.replace('Bearer ', '');

    if (!ADMIN_TOKEN || providedToken !== ADMIN_TOKEN) {
        return NextResponse.json({ error: '认证失败' }, { status: 401 });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return NextResponse.json({ error: '缺少 Supabase 配置' }, { status: 500 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !body.productId) {
        return NextResponse.json({ error: '缺少 productId' }, { status: 400 });
    }

    const { productId, name, content } = body;

    if (!name?.trim() && content === undefined) {
        return NextResponse.json({ error: '至少需要修改一个字段' }, { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 获取产品快照
    const { data: product } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .single();

    if (!product) {
        return NextResponse.json({ error: '产品不存在' }, { status: 404 });
    }

    // 1. 更新产品名称
    if (name?.trim() && name.trim() !== product.name) {
        const { error: updateError } = await supabase
            .from('products')
            .update({ name: name.trim() })
            .eq('id', productId);

        if (updateError) {
            return NextResponse.json({ error: `更新名称失败: ${updateError.message}` }, { status: 500 });
        }
    }

    // 2. 更新条款内容 + 重新生成向量
    let clauseUpdated = false;
    if (content !== undefined && content.trim()) {
        try {
            // 语义分段：按【标题】切分为多条独立条款
            const sections = splitClausesBySection(content.trim(), name?.trim() || product.name);
            const embeddings: number[][] = [];
            for (const section of sections) {
                const emb = await embedText(section, { model: EMBEDDING_MODEL });
                embeddings.push(emb);
            }

            // 先删除该产品的所有旧条款（全量替换，避免碎片残留）
            await supabase
                .from('clauses')
                .delete()
                .eq('product_id', productId);

            // 批量插入新条款
            const clauseRows = sections.map((section, i) => ({
                product_id: productId,
                content: section,
                embedding: embeddings[i],
            }));

            const { error: insertErr } = await supabase
                .from('clauses')
                .insert(clauseRows);

            if (insertErr) throw new Error(insertErr.message);
            clauseUpdated = true;
        } catch (err: any) {
            return NextResponse.json({
                error: `更新条款失败: ${err.message}`,
            }, { status: 500 });
        }
    }

    // 2.5 清除该产品的搜索缓存
    try {
        const cacheKey = normalizeProductName(name?.trim() || product.name);
        await supabase
            .from('search_cache')
            .delete()
            .eq('query_hash', cacheKey);
    } catch { /* 缓存清除失败不阻断 */ }

    // 3. 写审计日志
    try {
        await supabase.from('product_audit_log').insert({
            product_id: productId,
            action: 'UPDATE',
            operator: 'admin',
            before_snapshot: { name: product.name },
            after_snapshot: {
                ...(name?.trim() ? { name: name.trim() } : {}),
                ...(clauseUpdated ? { content: '(已更新条款并重新生成向量)' } : {}),
            },
            notes: '通过管理后台编辑',
        });
    } catch { /* 审计失败不阻断 */ }

    return NextResponse.json({
        success: true,
        message: clauseUpdated ? '名称和条款已更新，向量已重新生成' : '名称已更新',
    });
}

// GET: 获取产品的条款内容
export async function GET(req: Request) {
    const url = new URL(req.url);
    const productId = url.searchParams.get('productId');

    const authHeader = req.headers.get('Authorization');
    const providedToken = authHeader?.replace('Bearer ', '');
    if (!ADMIN_TOKEN || providedToken !== ADMIN_TOKEN) {
        return NextResponse.json({ error: '认证失败' }, { status: 401 });
    }

    if (!productId) {
        return NextResponse.json({ error: '缺少 productId' }, { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { data: clauses } = await supabase
        .from('clauses')
        .select('id, content')
        .eq('product_id', parseInt(productId))
        .order('id');

    // 多条条款拼接返回，编辑时作为完整文本展示
    const allContent = (clauses || []).map(c => c.content || '').join('\n');

    return NextResponse.json({
        success: true,
        content: allContent,
        clauseCount: clauses?.length || 0,
        clauseId: clauses?.[0]?.id || null,
    });
}
