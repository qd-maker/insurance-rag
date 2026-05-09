import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { askProductQuestion } from '@/lib/agent/product-agent';

export const runtime = 'nodejs';

const RequestSchema = z.object({
  productName: z.string().min(1, '请选择产品'),
  question: z.string().min(2, '请输入更完整的问题').max(300, '问题过长，请拆成更具体的问题'),
  history: z.array(z.object({
    question: z.string().min(1).max(300),
    answer: z.string().min(1).max(1200),
  })).max(6).optional(),
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

    const result = await askProductQuestion(
      getSupabase(),
      parsed.data.productName,
      parsed.data.question,
      parsed.data.history || []
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '问答失败' },
      { status: 500 }
    );
  }
}
