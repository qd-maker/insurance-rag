import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { compareProducts } from '@/lib/agent/product-agent';

export const runtime = 'nodejs';

const RequestSchema = z.object({
  products: z.array(z.string().min(1)).min(2, '请选择两个产品').max(2, '第一版只支持两个产品对比'),
  userProfile: z.string().max(500, '用户情况过长，请简化描述').optional(),
});

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('缺少 Supabase 环境变量');
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const parsed = RequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_REQUEST', details: parsed.error.issues }, { status: 400 });
    }

    const unique = Array.from(new Set(parsed.data.products));
    if (unique.length < 2) {
      return NextResponse.json({ error: '请选择两个不同产品' }, { status: 400 });
    }

    const result = await compareProducts(getSupabase(), unique, parsed.data.userProfile || '');
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '对比失败' },
      { status: 500 }
    );
  }
}
