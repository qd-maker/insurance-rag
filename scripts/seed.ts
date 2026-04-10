import dotenv from 'dotenv';
// 优先加载 .env.local，其次 .env
dotenv.config({ path: '.env.local' });
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { embedText } from '../src/lib/embeddings';
import { splitClausesBySection } from '../src/lib/chunking';

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

// 工具函数：为文本生成向量（使用多模态 API）
async function embed(text: string): Promise<number[]> {
  const embedding = await embedText(text, { model: EMBEDDING_MODEL });
  const expectedDim = Number(process.env.EMBEDDING_DIM || '1024');
  if (embedding.length !== expectedDim) {
    console.warn(`警告：embedding 维度为 ${embedding.length}，期望 ${expectedDim}。`);
  }
  return embedding;
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
      // 若提供 content，优先保留原始完整内容
      if (content && content.trim()) {
        console.log(`  检测到原始内容 content...`);

        // 仍然让 AI 生成简短 description
        const extracted = await analyzeProductContent(name, content.trim());
        if (!description && extracted.description) {
          description = extracted.description;
          console.log(`  AI 提取 description 完成`);
        }

        // ✅ 语义分段：按【标题】切分为多条独立条款
        // 每条保留段落标题，便于向量检索精准命中
        if (!clauses || clauses.length === 0) {
          clauses = splitClausesBySection(content.trim(), name);
          if (clauses.length > 1) {
            console.log(`  已按段落切分为 ${clauses.length} 条条款`);
          } else {
            console.log(`  使用完整原始内容作为条款（无可切分段落）`);
          }
        }
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

      // 先删除该产品的所有旧条款（全量替换，避免碎片残留）
      const { error: delErr } = await supabase
        .from('clauses')
        .delete()
        .eq('product_id', productId);
      if (delErr) {
        console.warn(`  清理旧条款失败: ${delErr.message}，将继续写入`);
      }

      // 写入新条款（逐条生成 embedding）
      for (const [ci, contentItem] of (clauses || []).entries()) {
        const text = (contentItem || '').trim();
        if (!text) {
          console.warn(`  条款第 ${ci + 1} 条为空，已跳过`);
          summary.clauses.skipped++;
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

  // ========== 🆕 新增：自动生成向量 ==========
  if (summary.clauses.inserted > 0) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔧 检测到新插入条款，开始自动生成向量...\n');

    try {
      // 查找所有没有向量的条款
      const { data: allClauses, error: queryErr } = await supabase
        .from('clauses')
        .select('id, content, embedding');

      if (queryErr) throw queryErr;

      const clausesWithoutVectors = allClauses?.filter(c => {
        return !c.embedding || !Array.isArray(c.embedding) || c.embedding.length === 0;
      }) || [];

      if (clausesWithoutVectors.length === 0) {
        console.log('所有条款都已有向量，跳过向量生成。');
      } else {
        console.log(`发现 ${clausesWithoutVectors.length} 条缺失向量的条款\n`);

        let vectorSuccess = 0;
        let vectorFailed = 0;

        for (const clause of clausesWithoutVectors) {
          try {
            console.log(`处理条款 #${clause.id}...`);

            if (!clause.content || clause.content.trim() === '') {
              console.log(`  ⚠️ 跳过：内容为空`);
              continue;
            }

            // 生成向量
            const embedding = await embed(clause.content);

            // 更新数据库
            const { error: updateErr } = await supabase
              .from('clauses')
              .update({ embedding })
              .eq('id', clause.id);

            if (updateErr) {
              console.log(`  ❌ 更新失败: ${updateErr.message}`);
              vectorFailed++;
            } else {
              console.log(`  ✅ 成功（${embedding.length}维）`);
              vectorSuccess++;
            }

            // 避免 API 限流
            await new Promise(resolve => setTimeout(resolve, 100));

          } catch (err: any) {
            console.log(`  ❌ 错误: ${err.message}`);
            vectorFailed++;
          }
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('向量生成完成！');
        console.log(`  ✅ 成功: ${vectorSuccess} 条`);
        console.log(`  ❌ 失败: ${vectorFailed} 条`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      }
    } catch (e: any) {
      console.error('\n向量生成失败：', e?.message || e);
      console.log('提示：可以稍后手动运行 npx tsx scripts/regenerate-vectors.ts');
    }
  }
  // ========== 自动向量生成结束 ==========

  // ========== 清空搜索缓存 ==========
  console.log('\n🔧 清空 search_cache（避免旧缓存干扰）...');
  try {
    const { error: cacheErr } = await supabase
      .from('search_cache')
      .delete()
      .neq('id', 0);
    if (cacheErr) throw cacheErr;
    console.log('✅ search_cache 已清空');
  } catch (e: any) {
    console.log(`⚠️ 清空缓存失败（可能表不存在）: ${e.message}`);
  }
}

main().catch((err) => {
  console.error('\n发生错误：', err);
  process.exit(1);
});
