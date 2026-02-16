import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { AuditLogQuerySchema, validateRequest, validationErrorResponse, type AuditLogEntry } from '@/lib/schemas';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function GET(req: Request) {
    // ============ 1. 验证 Token ============
    const authHeader = req.headers.get('Authorization');
    const providedToken = authHeader?.replace('Bearer ', '');

    if (!ADMIN_TOKEN) {
        return NextResponse.json({ error: '服务器未配置管理员 Token' }, { status: 500 });
    }

    if (providedToken !== ADMIN_TOKEN) {
        return NextResponse.json({ error: '认证失败：Token 无效' }, { status: 401 });
    }

    // ============ 2. Schema 校验查询参数 ============
    const url = new URL(req.url);
    const params = {
        productId: url.searchParams.get('productId') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
        offset: url.searchParams.get('offset') ?? undefined,
    };
    const parsed = validateRequest(AuditLogQuerySchema, params);
    if (!parsed.success) {
        return validationErrorResponse(parsed.error);
    }
    const { productId, limit, offset } = parsed.data;

    // ============ 3. 环境检查 ============
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return NextResponse.json({ error: '缺少 Supabase 配置' }, { status: 500 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    try {
        let query = supabase
            .from('product_audit_log')
            .select('*')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (productId) {
            query = query.eq('product_id', productId);
        }

        const { data: logs, error, count } = await query;

        if (error) {
            throw new Error(`查询失败: ${error.message}`);
        }

        // 补充产品名称
        const productIds = [...new Set((logs || []).map(l => l.product_id).filter(Boolean))];
        let productNames: Record<number, string> = {};

        if (productIds.length > 0) {
            const { data: products } = await supabase
                .from('products')
                .select('id, name')
                .in('id', productIds);

            productNames = (products || []).reduce((acc: Record<number, string>, p: any) => {
                acc[p.id] = p.name;
                return acc;
            }, {});
        }

        const enrichedLogs: AuditLogEntry[] = (logs || []).map(log => ({
            ...log,
            product_name: log.product_id ? productNames[log.product_id] : undefined,
        }));

        return NextResponse.json({
            success: true,
            logs: enrichedLogs,
            pagination: {
                offset,
                limit,
                total: count,
            },
        });

    } catch (error: any) {
        return NextResponse.json({
            success: false,
            error: error.message || '查询失败',
        }, { status: 500 });
    }
}
