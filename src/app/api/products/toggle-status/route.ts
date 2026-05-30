import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ProductToggleRequestSchema, parseAndValidate } from '@/lib/schemas';
import { getCacheKey } from '@/lib/retrieval';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
    const parsed = await parseAndValidate(req, ProductToggleRequestSchema);
    if (!parsed.success) {
        return parsed.response;
    }
    const { productId, active, notes } = parsed.data;

    // ============ 3. 环境检查 ============
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return NextResponse.json({ error: '缺少 Supabase 配置' }, { status: 500 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    try {
        // 查询当前产品状态
        const { data: product, error: queryErr } = await supabase
            .from('products')
            .select('id, name, is_active')
            .eq('id', productId)
            .single();

        if (queryErr || !product) {
            return NextResponse.json({ error: '产品不存在' }, { status: 404 });
        }

        const beforeActive = product.is_active;

        if (active) {
            const { count, error: clauseCountErr } = await supabase
                .from('clauses')
                .select('id', { count: 'exact', head: true })
                .eq('product_id', productId);

            if (clauseCountErr) {
                throw new Error(`校验条款失败: ${clauseCountErr.message}`);
            }

            if (!count) {
                return NextResponse.json({ error: '发布失败：该产品还没有可检索条款' }, { status: 400 });
            }
        }

        // 更新状态
        const { error: updateErr } = await supabase
            .from('products')
            .update({ is_active: active })
            .eq('id', productId);

        if (updateErr) {
            throw new Error(`更新失败: ${updateErr.message}`);
        }

        // ============ 自动清除该产品的缓存 ============
        let cacheCleared = 0;
        try {
            const cacheKey = getCacheKey(product.name);

            // 按 query_hash 清除
            const { data: deletedByHash } = await supabase
                .from('search_cache')
                .delete()
                .eq('query_hash', cacheKey)
                .select('id');

            // 按 query_text 清除（兼容）
            const { data: deletedByText } = await supabase
                .from('search_cache')
                .delete()
                .ilike('query_text', `%${product.name}%`)
                .select('id');

            cacheCleared = (deletedByHash?.length || 0) + (deletedByText?.length || 0);

            if (cacheCleared > 0) {
                console.log(`[Cache] 产品 "${product.name}" 状态变更，已清除 ${cacheCleared} 条缓存`);
            }
        } catch (cacheErr: unknown) {
            console.warn('[Cache] 清除缓存失败:', getErrorMessage(cacheErr));
        }

        // 写入审计日志
        const operatorName = req.headers.get('X-Operator-Name') || 'admin';
        const operatorIp = req.headers.get('X-Forwarded-For') || req.headers.get('X-Real-IP') || 'unknown';

        try {
            await supabase.from('product_audit_log').insert({
                product_id: productId,
                action: active ? 'PUBLISH' : 'UNPUBLISH',
                operator: operatorName,
                operator_ip: operatorIp,
                before_snapshot: { is_active: beforeActive },
                after_snapshot: { is_active: active },
                notes: notes || null,
                cache_cleared: cacheCleared,
            });
        } catch (auditErr: unknown) {
            console.warn('[Audit] 写入审计日志失败:', getErrorMessage(auditErr));
        }

        return NextResponse.json({
            success: true,
            message: active
                ? `产品 "${product.name}" 已发布，前台用户现在可以检索和咨询该产品。`
                : `产品 "${product.name}" 已下架，前台用户将不再看到该产品。`,
            product: {
                id: productId,
                name: product.name,
                is_active: active,
            },
        });

    } catch (error: unknown) {
        return NextResponse.json({
            success: false,
            message: getErrorMessage(error) || '操作失败',
        }, { status: 500 });
    }
}
