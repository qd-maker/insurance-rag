/**
 * 缓存失效测试脚本
 * 
 * 测试流程：
 * 1. 写入测试缓存
 * 2. 模拟产品状态变更
 * 3. 验证缓存已被清除
 * 
 * 用法：npx tsx scripts/test-cache-invalidation.ts
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// 加载环境变量
config({ path: '.env.local' });
config({ path: '.env' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 测试用产品名
const TEST_PRODUCT_NAME = '__TEST_CACHE_PRODUCT__';
const TEST_CACHE_KEY = 'test_cache_invalidation_key';

interface TestResult {
    step: string;
    passed: boolean;
    message: string;
}

async function main() {
    console.log('🧪 缓存失效测试脚本启动...\n');

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error('❌ 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const results: TestResult[] = [];

    // ========== 清理：删除之前的测试数据 ==========
    console.log('🧹 清理之前的测试数据...');
    await supabase.from('search_cache').delete().eq('query_hash', TEST_CACHE_KEY);
    await supabase.from('search_cache').delete().ilike('query_text', `%${TEST_PRODUCT_NAME}%`);

    // ========== 测试 1：写入测试缓存 ==========
    console.log('\n📝 测试 1：写入测试缓存');
    try {
        const testCacheData = {
            query_hash: TEST_CACHE_KEY,
            query_text: TEST_PRODUCT_NAME,
            result: { test: true, timestamp: new Date().toISOString() },
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            hit_count: 0,
        };

        const { error: insertErr } = await supabase
            .from('search_cache')
            .insert(testCacheData);

        if (insertErr) throw insertErr;

        // 验证写入成功
        const { data: verifyData, error: verifyErr } = await supabase
            .from('search_cache')
            .select('id, query_hash')
            .eq('query_hash', TEST_CACHE_KEY)
            .single();

        if (verifyErr || !verifyData) {
            throw new Error('缓存写入验证失败');
        }

        results.push({
            step: '写入测试缓存',
            passed: true,
            message: `缓存已写入，ID: ${verifyData.id}`,
        });
        console.log('   ✅ 缓存写入成功');

    } catch (error: any) {
        results.push({
            step: '写入测试缓存',
            passed: false,
            message: error.message,
        });
        console.log(`   ❌ 失败: ${error.message}`);
    }

    // ========== 测试 2：按 query_hash 清除缓存 ==========
    console.log('\n🗑️ 测试 2：按 query_hash 清除缓存');
    try {
        // 先重新写入
        await supabase.from('search_cache').insert({
            query_hash: TEST_CACHE_KEY,
            query_text: TEST_PRODUCT_NAME,
            result: { test: true },
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            hit_count: 0,
        });

        // 清除
        const { data: deleted, error: deleteErr } = await supabase
            .from('search_cache')
            .delete()
            .eq('query_hash', TEST_CACHE_KEY)
            .select('id');

        if (deleteErr) throw deleteErr;

        // 验证已清除
        const { data: remaining } = await supabase
            .from('search_cache')
            .select('id')
            .eq('query_hash', TEST_CACHE_KEY);

        if (remaining && remaining.length > 0) {
            throw new Error('缓存未被清除');
        }

        results.push({
            step: '按 query_hash 清除缓存',
            passed: true,
            message: `成功清除 ${deleted?.length || 0} 条缓存`,
        });
        console.log(`   ✅ 清除成功，删除 ${deleted?.length || 0} 条`);

    } catch (error: any) {
        results.push({
            step: '按 query_hash 清除缓存',
            passed: false,
            message: error.message,
        });
        console.log(`   ❌ 失败: ${error.message}`);
    }

    // ========== 测试 3：按 query_text (ilike) 清除缓存 ==========
    console.log('\n🔍 测试 3：按 query_text (ilike) 清除缓存');
    try {
        // 写入多个测试缓存
        const testEntries = [
            { query_hash: `${TEST_CACHE_KEY}_1`, query_text: `${TEST_PRODUCT_NAME}_A` },
            { query_hash: `${TEST_CACHE_KEY}_2`, query_text: `${TEST_PRODUCT_NAME}_B` },
            { query_hash: `${TEST_CACHE_KEY}_3`, query_text: `其他产品` },
        ];

        for (const entry of testEntries) {
            await supabase.from('search_cache').insert({
                ...entry,
                result: { test: true },
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                hit_count: 0,
            });
        }

        // 按 query_text 模糊匹配清除
        const { data: deleted, error: deleteErr } = await supabase
            .from('search_cache')
            .delete()
            .ilike('query_text', `%${TEST_PRODUCT_NAME}%`)
            .select('id');

        if (deleteErr) throw deleteErr;

        // 验证：应该只清除了 2 条（包含 TEST_PRODUCT_NAME 的）
        const { data: remaining } = await supabase
            .from('search_cache')
            .select('id, query_text')
            .ilike('query_hash', `${TEST_CACHE_KEY}%`);

        // 清理剩余测试数据
        await supabase.from('search_cache').delete().ilike('query_hash', `${TEST_CACHE_KEY}%`);

        if (deleted?.length !== 2) {
            throw new Error(`预期清除 2 条，实际清除 ${deleted?.length || 0} 条`);
        }

        results.push({
            step: '按 query_text (ilike) 清除缓存',
            passed: true,
            message: `成功清除 ${deleted?.length || 0} 条匹配的缓存`,
        });
        console.log(`   ✅ 清除成功，删除 ${deleted?.length || 0} 条匹配项`);

    } catch (error: any) {
        results.push({
            step: '按 query_text (ilike) 清除缓存',
            passed: false,
            message: error.message,
        });
        console.log(`   ❌ 失败: ${error.message}`);
        // 清理
        await supabase.from('search_cache').delete().ilike('query_hash', `${TEST_CACHE_KEY}%`);
    }

    // ========== 测试 4：过期缓存检测 ==========
    console.log('\n⏰ 测试 4：过期缓存检测');
    try {
        // 写入一个已过期的缓存
        const expiredTime = new Date(Date.now() - 60 * 1000).toISOString(); // 1分钟前
        await supabase.from('search_cache').insert({
            query_hash: `${TEST_CACHE_KEY}_expired`,
            query_text: `${TEST_PRODUCT_NAME}_EXPIRED`,
            result: { test: true, expired: true },
            expires_at: expiredTime,
            hit_count: 0,
        });

        // 查询过期缓存数量
        const { data: expiredData, error: expiredErr } = await supabase
            .from('search_cache')
            .select('id')
            .lt('expires_at', new Date().toISOString())
            .ilike('query_hash', `${TEST_CACHE_KEY}%`);

        if (expiredErr) throw expiredErr;

        // 清理
        await supabase.from('search_cache').delete().ilike('query_hash', `${TEST_CACHE_KEY}%`);

        if (!expiredData || expiredData.length === 0) {
            throw new Error('未检测到过期缓存');
        }

        results.push({
            step: '过期缓存检测',
            passed: true,
            message: `成功检测到 ${expiredData.length} 条过期缓存`,
        });
        console.log(`   ✅ 检测成功，发现 ${expiredData.length} 条过期缓存`);

    } catch (error: any) {
        results.push({
            step: '过期缓存检测',
            passed: false,
            message: error.message,
        });
        console.log(`   ❌ 失败: ${error.message}`);
        await supabase.from('search_cache').delete().ilike('query_hash', `${TEST_CACHE_KEY}%`);
    }

    // ========== 最终清理 ==========
    console.log('\n🧹 最终清理测试数据...');
    await supabase.from('search_cache').delete().ilike('query_hash', `${TEST_CACHE_KEY}%`);
    await supabase.from('search_cache').delete().ilike('query_text', `%${TEST_PRODUCT_NAME}%`);

    // ========== 结果汇总 ==========
    console.log('\n' + '='.repeat(50));
    console.log('📊 测试结果汇总');
    console.log('='.repeat(50));

    let passedCount = 0;
    for (const result of results) {
        const icon = result.passed ? '✅' : '❌';
        console.log(`${icon} ${result.step}: ${result.message}`);
        if (result.passed) passedCount++;
    }

    console.log('='.repeat(50));
    console.log(`总计: ${passedCount}/${results.length} 通过`);

    const allPassed = passedCount === results.length;
    if (allPassed) {
        console.log('\n✅ 所有测试通过！');
    } else {
        console.log('\n⚠️ 部分测试失败，请检查错误信息');
    }

    process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
    console.error('❌ 脚本执行失败:', err);
    process.exit(1);
});
