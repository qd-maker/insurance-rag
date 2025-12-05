import dotenv from 'dotenv';
// 优先加载 .env.local，其次 .env
dotenv.config({ path: '.env.local' });
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// 从本地数据文件读取待插入的数据
// 请在 scripts/seedData.ts 中导出 productsToInsert 数组
// 形如：export const productsToInsert = [{ name: string, description?: string, clauses?: string[], content?: string }, ...]
import { productsToInsert } from './seedData';

// 环境变量
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL; // 支持聚合/代理
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'; // 1536 维
const GENERATION_MODEL = process.env.GENERATION_MODEL || 'gpt-4o-mini';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY（或 NEXT_PUBLIC_SUPABASE_ANON_KEY）。');
}
if (!OPENAI_API_KEY) {
  throw new Error('缺少 OPENAI_API_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: OPENAI_BASE_URL });

// 统一名称/文本的归一化，便于做“逻辑等价”的比较
function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\u3000]/g, '')
    // 注意字符类中连字符应置于末尾以避免范围
    .replace(/[()（）［］【】\[\]·•．・。、，,._/:\\'’"“”-]+/g, '');
}

// 工具函数：为文本生成 1536 维向量
async function embed(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: text });
  const v = res.data[0].embedding;
  if (!Array.isArray(v) || v.length !== 1536) {
    // 某些聚合可能返回不同维度，请确保与你的表定义一致
    console.warn(`警告：embedding 维度为 ${Array.isArray(v) ? v.length : 'unknown'}，表定义为 1536。`);
  }
  return v as unknown as number[];
}

// 当提供 content 时，利用模型从原始文本自动抽取 description 与 clauses
async function analyzeProductContent(name: string, content: string): Promise<{ description: string; clauses: string[] }> {
  const sys = `你是保险结构化抽取助手。输出严格 JSON（application/json），不要多余文本。`;
  const user = `请从以下产品原始描述中抽取：\n- description: 对产品的简短概述（不超过80字，避免营销用语）\n- clauses: 2-12 条清晰独立的条款句子，用于向量检索（去除重复，保持信息最完整且简洁）。\n\n产品名：${name}\n原始内容：\n${content}\n\n以如下 JSON 返回：{ "description": string, "clauses": string[] }`;
  const chat = await openai.chat.completions.create({
    model: GENERATION_MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' } as any,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
  });
  const txt = chat.choices?.[0]?.message?.content?.trim() || '{}';
  try {
    const j = JSON.parse(txt);
    const description = (j?.description ?? '').toString().trim();
    const clauses = Array.isArray(j?.clauses) ? j.clauses.map((x: any) => String(x || '').trim()).filter((s: string) => !!s) : [];
    return { description, clauses };
  } catch {
    return { description: '', clauses: [] };
  }
}

async function main() {
  const summary = {
    products: { created: 0, updated: 0, skipped: 0, failed: 0 },
    clauses: { inserted: 0, skipped: 0, failed: 0 },
  };

  console.log(`共 ${productsToInsert.length} 个产品待处理...`);

  for (const [pi, product] of productsToInsert.entries()) {
    const name = (product as any)?.name as string;
    if (!name) {
      console.warn(`跳过第 ${pi + 1} 个产品：缺少 name`);
      summary.products.skipped++;
      continue;
    }

    let description: string | null = (product as any).description ?? null;
    let clauses: string[] = (product as any).clauses ?? [];
    const content: string | undefined = (product as any).content;

    console.log(`\n[${pi + 1}/${productsToInsert.length}] 处理产品：${name}`);

    try {
      // 若提供 content，则自动抽取；优先保留显式提供的字段
      if (content && content.trim()) {
        console.log(`  检测到原始内容 content，调用模型抽取 description 与 clauses...`);
        const extracted = await analyzeProductContent(name, content.trim());
        if (!description && extracted.description) description = extracted.description;
        if ((!clauses || clauses.length === 0) && extracted.clauses?.length) clauses = extracted.clauses;
        console.log(`  抽取完成：description=${description ? '有' : '无'}，clauses=${clauses.length} 条`);
      }

      // 幂等 upsert：按归一化名称匹配
      const nName = normalize(name);
      const { data: candidates, error: candErr } = await supabase
        .from('products')
        .select('id,name,description')
        .ilike('name', `%${name}%`)
        .limit(50);
      if (candErr) throw new Error(`查询现有产品失败：${candErr.message}`);

      let matched: { id: number; name: string; description: string | null } | null = null;
      for (const c of candidates ?? []) {
        if (normalize((c as any).name) === nName) { matched = c as any; break; }
      }

      let productId: number;
      if (matched) {
        productId = matched.id;
        // 若提供了新的 description，且与旧值不同，则更新
        if (description && description !== (matched.description ?? '')) {
          const { error: updErr } = await supabase
            .from('products')
            .update({ description })
            .eq('id', productId);
          if (updErr) throw new Error(`更新产品描述失败：${updErr.message}`);
          console.log(`  已更新产品描述（id=${productId}）`);
          summary.products.updated++;
        } else {
          summary.products.skipped++;
          console.log(`  产品已存在（id=${productId}），描述无变化`);
        }
      } else {
    const { data: insertedProduct, error: prodErr } = await supabase
      .from('products')
      .insert({ name, description })
      .select('id')
      .single();
        if (prodErr) throw new Error(`插入产品失败：${prodErr.message}`);
        productId = insertedProduct!.id as number;
        summary.products.created++;
        console.log(`  已创建产品（id=${productId}）`);
      }

      // 写入条款（去重：同产品下 content 完全一致则跳过）
      for (const [ci, contentItem] of (clauses || []).entries()) {
        const text = (contentItem || '').trim();
      if (!text) {
        console.warn(`  条款第 ${ci + 1} 条为空，已跳过`);
          summary.clauses.skipped++;
        continue;
      }

        // 先查重再嵌入，避免不必要的 embedding 成本
        const { count: dupCount, error: dupErr } = await supabase
          .from('clauses')
          .select('id', { count: 'exact', head: true })
          .eq('product_id', productId)
          .eq('content', text);
        if (dupErr) {
          console.warn(`  查重失败（第 ${ci + 1} 条）：${dupErr.message}，将尝试继续写入`);
        }
        if ((dupCount ?? 0) > 0) {
          summary.clauses.skipped++;
          console.log(`  [${ci + 1}/${clauses.length}] 已存在，跳过`);
          continue;
      }

        // 生成向量并写入
        try {
          const embedding = await embed(text);
      const { error: clauseErr } = await supabase.from('clauses').insert({
        product_id: productId,
        content: text,
        embedding,
      });
          if (clauseErr) throw clauseErr;
          summary.clauses.inserted++;
          console.log(`  [${ci + 1}/${clauses.length}] 条款已写入`);
        } catch (e: any) {
          summary.clauses.failed++;
          console.error(`  插入条款失败（第 ${ci + 1} 条）：${e?.message || e}`);
        }
      }

      console.log(`产品 ${name} 处理完成。`);
    } catch (e: any) {
      summary.products.failed++;
      console.error(`处理产品 ${name} 失败：${e?.message || e}`);
      continue; // 不中断后续产品
    }
  }

  // 总结报告
  console.log('\n==== 导入总结报告 ====');
  console.log(`产品：创建 ${summary.products.created}，更新 ${summary.products.updated}，跳过 ${summary.products.skipped}，失败 ${summary.products.failed}`);
  console.log(`条款：插入 ${summary.clauses.inserted}，跳过 ${summary.clauses.skipped}，失败 ${summary.clauses.failed}`);

  const hasFailures = summary.products.failed > 0 || summary.clauses.failed > 0;
  if (hasFailures) {
    console.log('\n部分操作失败，请检查上方日志。');
    process.exit(1);
  } else {
    console.log('\n全部成功 ✅');
  }
}

main().catch((err) => {
  console.error('\n发生错误：', err);
  process.exit(1);
});
