export const runtime = 'nodejs';
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ProductCheckQuerySchema, validateRequest, validationErrorResponse } from "@/lib/schemas";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const sb = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s\u3000]/g, "")
    // 注意字符类中连字符应置于末尾以避免范围
    .replace(/[()（）［］【】\[\]·•．・。、，,._/:\\'’"“”-]+/g, "");
}

export async function GET(req: NextRequest) {
  try {
    // ========== Schema 校验查询参数 ==========
    const params = { q: req.nextUrl.searchParams.get("q") ?? "" };
    const parsed = validateRequest(ProductCheckQuerySchema, params);
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }
    const q = parsed.data.q.trim();

    if (!q) {
      return NextResponse.json({
        ok: true,
        imported: false,
        productExists: false,
        clauseExists: false,
        suggestions: [],
      });
    }

    const qNorm = normalize(q);

    // 1) 候选（轻量模糊）
    const { data: candidates, error } = await sb
      .from("products")
      .select("id,name")
      .ilike("name", `%${q}%`)
      .limit(20);
    if (error) throw error;

    // 2) 归一化精确命中
    let matched: { id: number; name: string } | null = null;
    for (const c of candidates ?? []) {
      const name = (c as any).name as string;
      if (normalize(name) === qNorm) {
        matched = c as any;
        break;
      }
    }

    const productExists = !!matched;

    // 3) 统计 clauses 是否存在
    let clauseExists = false;
    if (matched) {
      const { count, error: e2 } = await sb
        .from("clauses")
        .select("id", { count: "exact", head: true })
        .eq("product_id", matched.id);
      if (e2) throw e2;
      clauseExists = (count ?? 0) > 0;
    }

    const suggestions = (candidates ?? []).slice(0, 5).map((x: any) => x.name as string);

    return NextResponse.json({
      ok: true,
      imported: productExists && clauseExists,
      productExists,
      clauseExists,
      matchedProductId: matched?.id,
      matchedProductName: matched?.name,
      suggestions,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "UNKNOWN" }, { status: 500 });
  }
}

