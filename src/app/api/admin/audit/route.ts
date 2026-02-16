/**
 * 审计日志查询 API
 * 
 * GET /api/admin/audit?product_id=1&limit=50
 * 返回操作历史记录
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: Request) {
    try {
        // 验证管理员 Token
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ error: '缺少认证信息' }, { status: 401 });
        }

        const token = authHeader.slice(7).trim();
        const adminToken = process.env.ADMIN_TOKEN;

        if (!adminToken || token !== adminToken) {
            return NextResponse.json({ error: 'Token 无效' }, { status: 401 });
        }

        // 初始化 Supabase
        const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            return NextResponse.json({ error: '缺少 Supabase 配置' }, { status: 500 });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 解析查询参数
        const url = new URL(req.url);
        const productId = url.searchParams.get('product_id');
        const action = url.searchParams.get('action');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);

        // 构建查询
        let query = supabase
            .from('audit_log')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        // 可选过滤条件
        if (productId) {
            query = query.eq('product_id', parseInt(productId, 10));
        }
        if (action) {
            query = query.eq('action', action);
        }

        const { data, error, count } = await query;

        if (error) {
            console.error('[Audit] Query error:', error);
            return NextResponse.json({ error: '查询审计日志失败', details: error.message }, { status: 500 });
        }

        // 格式化响应
        const logs = (data || []).map(log => ({
            id: log.id,
            action: log.action,
            productId: log.product_id,
            productName: log.product_name,
            operator: log.operator || 'admin',
            details: log.details,
            createdAt: log.created_at,
        }));

        return NextResponse.json({
            logs,
            pagination: {
                total: count || 0,
                limit,
                offset,
                hasMore: (count || 0) > offset + limit,
            },
        });

    } catch (e: any) {
        console.error('[Audit] Error:', e);
        return NextResponse.json({ error: e?.message || '服务器错误' }, { status: 500 });
    }
}
