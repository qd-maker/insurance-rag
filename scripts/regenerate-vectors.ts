/**
 * 修复脚本：为所有缺失向量的条款重新生成向量
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { embedText } from '../src/lib/embeddings';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-ada-002';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('❌ Supabase 配置缺失');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function regenerateVectors() {
    // --missing 参数：仅处理缺失向量的条款；默认全量重生成
    const missingOnly = process.argv.includes('--missing');
    const mode = missingOnly ? '仅缺失向量' : '全量重生成（模型/维度迁移）';

    console.log(`🔧 向量生成模式: ${mode}\n`);
    console.log(`使用模型: ${EMBEDDING_MODEL}\n`);

    // 1. 查询所有条款
    const { data: allClauses, error } = await supabase
        .from('clauses')
        .select('id, product_id, content, embedding');

    if (error) {
        console.log(`❌ 查询失败: ${error.message}`);
        return;
    }

    // 2. 根据模式筛选需要处理的条款
    const clausesToProcess = missingOnly
        ? (allClauses?.filter(c => !c.embedding || !Array.isArray(c.embedding) || c.embedding.length === 0) || [])
        : (allClauses || []);

    console.log(`总条款: ${allClauses?.length || 0} 条，待处理: ${clausesToProcess.length} 条\n`);

    if (clausesToProcess.length === 0) {
        console.log('✅ 无需处理的条款！');
        return;
    }

    // 2. 为每条生成并更新向量
    let success = 0;
    let failed = 0;

    for (const clause of clausesToProcess) {
        try {
            console.log(`处理条款 #${clause.id}...`);

            if (!clause.content || clause.content.trim() === '') {
                console.log(`  ⚠️ 跳过：内容为空`);
                continue;
            }

            // 生成向量
            const embedding = await embedText(clause.content, { model: EMBEDDING_MODEL });

            // 更新数据库
            const { error: updateError } = await supabase
                .from('clauses')
                .update({ embedding })
                .eq('id', clause.id);

            if (updateError) {
                console.log(`  ❌ 更新失败: ${updateError.message}`);
                failed++;
            } else {
                console.log(`  ✅ 成功（${embedding.length}维）`);
                success++;
            }

            // 避免 API 限流
            await new Promise(resolve => setTimeout(resolve, 100));

        } catch (err: any) {
            console.log(`  ❌ 错误: ${err.message}`);
            failed++;
        }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('修复完成！');
    console.log(`  ✅ 成功: ${success} 条`);
    console.log(`  ❌ 失败: ${failed} 条`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

regenerateVectors();
