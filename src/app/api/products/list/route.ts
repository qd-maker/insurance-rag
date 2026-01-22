import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';
import { ProductListResponseSchema } from '@/lib/schemas';

export const runtime = 'nodejs';

// 别名文件路径
const ALIASES_PATH = path.join(process.cwd(), 'data', 'product-aliases.json');

interface ProductAlias {
    aliases: string[];
    version: string;
    last_updated: string;
    source: string;
}

type AliasesMap = Record<string, ProductAlias>;

export async function GET() {
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return NextResponse.json({ error: 'Missing Supabase credentials' }, { status: 500 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    try {
        // 1. 获取数据库中的产品列表，并统计每个产品的条款数量
        const { data: products, error } = await supabase
            .from('products')
            .select(`
                id, 
                name,
                description,
                is_active,
                created_at,
                updated_at,
                created_by,
                clauses(count)
            `)
            .order('id');

        if (error) throw error;

        // 2. 加载别名配置
        let aliasesMap: AliasesMap = {};
        if (fs.existsSync(ALIASES_PATH)) {
            try {
                const fileContent = fs.readFileSync(ALIASES_PATH, 'utf-8');
                aliasesMap = JSON.parse(fileContent);
            } catch (e) {
                console.error('Error reading product-aliases.json:', e);
            }
        }

        // 3. 过滤出有条款的产品并合并数据
        const productList = (products || [])
            .filter((p: any) => {
                // 只保留有条款的产品（clause count > 0）
                const clauseCount = p.clauses?.[0]?.count || 0;
                return clauseCount > 0;
            })
            .map((p: any) => {
                const aliasInfo = aliasesMap[p.name] || {};
                return {
                    id: p.id,
                    name: p.name,
                    description: p.description || null,
                    is_active: p.is_active !== false,  // 默认为 true
                    created_at: p.created_at || null,
                    updated_at: p.updated_at || null,
                    created_by: p.created_by || null,
                    aliases: aliasInfo.aliases || [],
                    version: aliasInfo.version || '未知版本',
                    last_updated: aliasInfo.last_updated || '未知',
                    source: aliasInfo.source || '未知来源'
                };
            });

        // Schema 校验响应数据
        const validated = ProductListResponseSchema.safeParse(productList);
        if (!validated.success) {
            console.error('[Schema] ProductList validation failed:', validated.error.issues);
            return NextResponse.json({
                error: 'SCHEMA_VIOLATION',
                message: '响应数据结构校验失败',
                details: validated.error.issues,
            }, { status: 500 });
        }

        return NextResponse.json(validated.data);
    } catch (e: any) {
        console.error('API Error:', e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
