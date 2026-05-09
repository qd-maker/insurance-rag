import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { explainProduct } from '@/lib/agent/product-agent';

export const runtime = 'nodejs';

const RequestSchema = z.object({
  productName: z.string().min(1, '请选择产品'),
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

    const result = await explainProduct(getSupabase(), parsed.data.productName);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '解读失败' },
      { status: 500 }
    );
  }
}
