/**
 * 检索调试 API
 * 
 * 仅返回检索中间结果，不调用 LLM，用于调试检索质量
 * 仅在 debug=true 时返回详细信息
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hybridRetrieve, getProductNames, RETRIEVAL_CONFIG } from '@/lib/retrieval';
import { z } from 'zod';

export const runtime = 'nodejs';

const DebugRetrievalRequestSchema = z.object({
    query: z.string().min(1, '查询不能为空'),
    matchCount: z.number().int().min(1).max(50).optional().default(10),
    matchThreshold: z.number().min(0).max(1).optional().default(0.3),
    debug: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
    try {
        // 初始化 Supabase
        const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            return NextResponse.json({ error: '缺少 Supabase 配置' }, { status: 500 });
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 解析请求
        const body = await req.json();
        const parsed = DebugRetrievalRequestSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json({
                error: 'VALIDATION_ERROR',
                details: parsed.error.issues,
            }, { status: 400 });
        }

        const { query, matchCount, matchThreshold, debug } = parsed.data;

        // 调用混合检索
        const startTime = Date.now();
        const retrievalResult = await hybridRetrieve(query, supabase, {
            matchCount,
            matchThreshold,
            debug: true, // 始终开启 debug 以获取中间结果
        });
        const retrievalDuration = Date.now() - startTime;

        const { rows, priorityProductIds, matchedProductName, strategy, vectorMatches, allProducts } = retrievalResult;

        // 获取产品名映射
        const productIds = Array.from(new Set(rows.map(r => r.product_id).filter(Boolean))) as number[];
        const productNames = await getProductNames(supabase, productIds);

        // 构建响应
        const response: any = {
            query,
            strategy,
            matchedProductName,
            priorityProductIds,
            retrievalDuration,
            config: RETRIEVAL_CONFIG,
            results: {
                count: rows.length,
                rows: rows.map(r => ({
                    id: r.id,
                    product_id: r.product_id,
                    product_name: r.product_id ? productNames[r.product_id] : null,
                    similarity: r.similarity,
                    content_preview: r.content?.slice(0, 200) + (r.content && r.content.length > 200 ? '...' : ''),
                })),
            },
        };

        // debug 模式下返回更多信息
        if (debug) {
            response._debug = {
                vectorMatchesCount: vectorMatches?.length || 0,
                vectorMatches: vectorMatches?.slice(0, 10).map(r => ({
                    id: r.id,
                    product_id: r.product_id,
                    similarity: r.similarity,
                })),
                allProductsCount: allProducts?.length || 0,
                allProducts: allProducts?.slice(0, 20),
            };
        }

        return NextResponse.json(response);

    } catch (error: any) {
        console.error('[Debug Retrieval] Error:', error);
        return NextResponse.json({
            error: 'INTERNAL_ERROR',
            message: error?.message || 'Unknown error',
        }, { status: 500 });
    }
}

// GET 方法支持简单测试
export async function GET(req: Request) {
    const url = new URL(req.url);
    const query = url.searchParams.get('query');

    if (!query) {
        return NextResponse.json({
            error: 'MISSING_QUERY',
            message: '请提供 query 参数',
            usage: 'GET /api/debug/retrieval?query=产品名&debug=true',
        }, { status: 400 });
    }

    // 转换为 POST 请求处理
    const body = {
        query,
        matchCount: Number(url.searchParams.get('matchCount')) || 10,
        matchThreshold: Number(url.searchParams.get('matchThreshold')) || 0.3,
        debug: url.searchParams.get('debug') !== 'false',
    };

    const mockReq = new Request(req.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    return POST(mockReq);
}
