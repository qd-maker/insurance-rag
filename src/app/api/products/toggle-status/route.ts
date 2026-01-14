import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

    // ============ 2. 解析请求体 ============
    let body: { productId?: number; active?: boolean; notes?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
    }

    const { productId, active, notes } = body;

    if (typeof productId !== 'number') {
        return NextResponse.json({ error: 'productId 必须是数字' }, { status: 400 });
    }

    if (typeof active !== 'boolean') {
        return NextResponse.json({ error: 'active 必须是布尔值' }, { status: 400 });
    }

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

        // 更新状态
        const { error: updateErr } = await supabase
            .from('products')
            .update({ is_active: active })
            .eq('id', productId);

        if (updateErr) {
            throw new Error(`更新失败: ${updateErr.message}`);
        }

        // 写入审计日志
        const operatorName = req.headers.get('X-Operator-Name') || 'admin';
        const operatorIp = req.headers.get('X-Forwarded-For') || req.headers.get('X-Real-IP') || 'unknown';

        try {
            await supabase.from('product_audit_log').insert({
                product_id: productId,
                action: active ? 'ENABLE' : 'DISABLE',
                operator: operatorName,
                operator_ip: operatorIp,
                before_snapshot: { is_active: beforeActive },
                after_snapshot: { is_active: active },
                notes: notes || null,
            });
        } catch (auditErr: any) {
            console.warn('[Audit] 写入审计日志失败:', auditErr.message);
        }

        return NextResponse.json({
            success: true,
            message: `产品 "${product.name}" 已${active ? '启用' : '禁用'}`,
            product: {
                id: productId,
                name: product.name,
                is_active: active,
            },
        });

    } catch (error: any) {
        return NextResponse.json({
            success: false,
            message: error.message || '操作失败',
        }, { status: 500 });
    }
}
