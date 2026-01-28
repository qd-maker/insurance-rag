/**
 * 缓存管理 API
 * 
 * DELETE /api/admin/cache?product=产品名 - 按产品名清除缓存
 * GET /api/admin/cache/stats - 返回缓存统计信息
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCacheKey } from '@/lib/retrieval';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function verifyAdminToken(req: Request): { valid: boolean; error?: string } {
    const authHeader = req.headers.get('Authorization');
    const providedToken = authHeader?.replace('Bearer ', '');

    if (!ADMIN_TOKEN) {
        return { valid: false, error: '服务器未配置管理员 Token' };
    }

    if (providedToken !== ADMIN_TOKEN) {
        return { valid: false, error: '认证失败：Token 无效' };
    }

    return { valid: true };
}

/**
 * DELETE - 清除指定产品的缓存
 */
export async function DELETE(req: Request) {
    // 验证 Token
    const auth = verifyAdminToken(req);
    if (!auth.valid) {
        return NextResponse.json({ error: auth.error }, { status: auth.error?.includes('未配置') ? 500 : 401 });
    }

    // 获取产品名参数
    const url = new URL(req.url);
    const productName = url.searchParams.get('product');

    if (!productName) {
        return NextResponse.json({
            error: '缺少 product 参数',
            usage: 'DELETE /api/admin/cache?product=产品名',
        }, { status: 400 });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return NextResponse.json({ error: '缺少 Supabase 配置' }, { status: 500 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    try {
        // 使用归一化的缓存键清除
        const cacheKey = getCacheKey(productName);

        // 按 query_hash 清除（精确匹配）
        const { data: deletedByHash, error: hashErr } = await supabase
            .from('search_cache')
            .delete()
            .eq('query_hash', cacheKey)
            .select('id');

        // 按 query_text 清除（模糊匹配，兼容旧数据）
        const { data: deletedByText, error: textErr } = await supabase
            .from('search_cache')
            .delete()
            .ilike('query_text', `%${productName}%`)
            .select('id');

        if (hashErr || textErr) {
            throw new Error(hashErr?.message || textErr?.message);
        }

        const totalCleared = (deletedByHash?.length || 0) + (deletedByText?.length || 0);

        console.log(`[Cache] 清除产品 "${productName}" 缓存，共 ${totalCleared} 条`);

        return NextResponse.json({
            cleared: true,
            product: productName,
            count: totalCleared,
            details: {
                byHash: deletedByHash?.length || 0,
                byText: deletedByText?.length || 0,
            },
        });

    } catch (error: any) {
        console.error('[Cache] 清除缓存失败:', error);
        return NextResponse.json({
            cleared: false,
            error: error.message || '清除缓存失败',
        }, { status: 500 });
    }
}

/**
 * GET - 获取缓存统计信息
 */
export async function GET(req: Request) {
    // 验证 Token
    const auth = verifyAdminToken(req);
    if (!auth.valid) {
        return NextResponse.json({ error: auth.error }, { status: auth.error?.includes('未配置') ? 500 : 401 });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return NextResponse.json({ error: '缺少 Supabase 配置' }, { status: 500 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    try {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        // 获取所有缓存条目
        const { data: allCache, error: allErr } = await supabase
            .from('search_cache')
            .select('id, query_hash, query_text, hit_count, expires_at, created_at');

        if (allErr) throw allErr;

        const cacheEntries = allCache || [];

        // 统计指标
        const totalEntries = cacheEntries.length;
        const totalHits = cacheEntries.reduce((sum, e) => sum + (e.hit_count || 0), 0);
        const expiredCount = cacheEntries.filter(e => new Date(e.expires_at) < now).length;
        const activeCount = totalEntries - expiredCount;

        // 24小时内创建的缓存
        const recent24h = cacheEntries.filter(e => new Date(e.created_at) > yesterday);
        const hits24h = recent24h.reduce((sum, e) => sum + (e.hit_count || 0), 0);

        // 缓存命中率（估算：hits / (hits + entries)）
        const hitRate24h = recent24h.length > 0
            ? (hits24h / (hits24h + recent24h.length) * 100).toFixed(1)
            : '0.0';

        // 按产品分组统计
        const byProduct: Record<string, { count: number; hits: number }> = {};
        for (const entry of cacheEntries) {
            const product = entry.query_text || 'unknown';
            if (!byProduct[product]) {
                byProduct[product] = { count: 0, hits: 0 };
            }
            byProduct[product].count++;
            byProduct[product].hits += entry.hit_count || 0;
        }

        return NextResponse.json({
            enabled: process.env.ENABLE_SEARCH_CACHE === 'true',
            stats: {
                totalEntries,
                activeCount,
                expiredCount,
                totalHits,
                hitRate24h: `${hitRate24h}%`,
            },
            byProduct,
            timestamp: now.toISOString(),
        });

    } catch (error: any) {
        console.error('[Cache] 获取统计失败:', error);
        return NextResponse.json({
            error: error.message || '获取缓存统计失败',
        }, { status: 500 });
    }
}
