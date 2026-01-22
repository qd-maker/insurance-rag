/**
 * Schema 校验单元测试
 * 运行: npx tsx scripts/test-schemas.ts
 */

import {
    ProductAddRequestSchema,
    ProductListResponseSchema,
    ProductListItemSchema,
    ClauseInputSchema,
    SearchSuccessResponseSchema,
    SearchRequestSchema,
    ProductToggleRequestSchema,
    ProductCheckQuerySchema,
} from '../src/lib/schemas';

// ============ 测试工具函数 ============

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void) {
    try {
        fn();
        console.log(`✅ PASS: ${name}`);
        passCount++;
    } catch (error: any) {
        console.log(`❌ FAIL: ${name}`);
        console.log(`   Error: ${error.message}`);
        failCount++;
    }
}

function expect(value: any) {
    return {
        toBe(expected: any) {
            if (value !== expected) {
                throw new Error(`Expected ${expected}, got ${value}`);
            }
        },
        toBeTrue() {
            if (value !== true) {
                throw new Error(`Expected true, got ${value}`);
            }
        },
        toBeFalse() {
            if (value !== false) {
                throw new Error(`Expected false, got ${value}`);
            }
        },
        toHaveLength(len: number) {
            if (!Array.isArray(value) || value.length !== len) {
                throw new Error(`Expected array of length ${len}, got ${value?.length}`);
            }
        },
    };
}

// ============ ProductAddRequestSchema 测试 ============

console.log('\n📦 ProductAddRequestSchema 测试\n');

test('正常输入应通过', () => {
    const result = ProductAddRequestSchema.safeParse({
        name: '安心无忧医疗险',
        content: '这是一款百万医疗险产品...',
    });
    expect(result.success).toBeTrue();
});

test('带 clauses 数组应通过', () => {
    const result = ProductAddRequestSchema.safeParse({
        name: '安心无忧医疗险',
        content: '这是一款百万医疗险产品...',
        clauses: [
            { content: '这是第一个条款内容，至少需要10个字符' },
            { title: '第二条款', content: '这是第二个条款内容，至少需要10个字符' },
        ],
    });
    expect(result.success).toBeTrue();
});

test('空 name 应拒绝', () => {
    const result = ProductAddRequestSchema.safeParse({
        name: '',
        content: '这是内容',
    });
    expect(result.success).toBeFalse();
});

test('空 content 应拒绝', () => {
    const result = ProductAddRequestSchema.safeParse({
        name: '产品名',
        content: '',
    });
    expect(result.success).toBeFalse();
});

test('超长 name (>200字) 应拒绝', () => {
    const result = ProductAddRequestSchema.safeParse({
        name: 'a'.repeat(201),
        content: '正常内容',
    });
    expect(result.success).toBeFalse();
});

test('clauses 空数组应拒绝 (min(1))', () => {
    const result = ProductAddRequestSchema.safeParse({
        name: '产品名',
        content: '内容',
        clauses: [],
    });
    expect(result.success).toBeFalse();
});

// ============ ClauseInputSchema 测试 ============

console.log('\n📄 ClauseInputSchema 测试\n');

test('正常条款应通过', () => {
    const result = ClauseInputSchema.safeParse({
        title: '第一条',
        content: '这是条款内容，至少需要10个字符',
    });
    expect(result.success).toBeTrue();
});

test('无 title 应通过（optional）', () => {
    const result = ClauseInputSchema.safeParse({
        content: '这是条款内容，至少需要10个字符',
    });
    expect(result.success).toBeTrue();
});

test('content 太短 (<10字符) 应拒绝', () => {
    const result = ClauseInputSchema.safeParse({
        content: '太短了',
    });
    expect(result.success).toBeFalse();
});

test('content 超长 (>50000字) 应拒绝', () => {
    const result = ClauseInputSchema.safeParse({
        content: 'a'.repeat(50001),
    });
    expect(result.success).toBeFalse();
});

// ============ ProductListResponseSchema 测试 ============

console.log('\n📋 ProductListResponseSchema 测试\n');

test('正常产品列表应通过', () => {
    const result = ProductListResponseSchema.safeParse([
        {
            id: 1,
            name: '安心无忧医疗险',
            description: '百万医疗险',
            is_active: true,
            created_at: '2024-01-01',
            updated_at: '2024-01-02',
            created_by: 'admin',
            aliases: ['安心医疗', '无忧医疗'],
            version: '1.0',
            last_updated: '2024-01-02',
            source: 'database',
        },
    ]);
    expect(result.success).toBeTrue();
});

test('空数组应通过', () => {
    const result = ProductListResponseSchema.safeParse([]);
    expect(result.success).toBeTrue();
});

test('缺少必填字段 id 应拒绝', () => {
    const result = ProductListResponseSchema.safeParse([
        {
            name: '产品名',
            is_active: true,
        },
    ]);
    expect(result.success).toBeFalse();
});

test('id 为 null 应拒绝', () => {
    const result = ProductListResponseSchema.safeParse([
        {
            id: null,
            name: '产品名',
        },
    ]);
    expect(result.success).toBeFalse();
});

test('非数组类型应拒绝', () => {
    const result = ProductListResponseSchema.safeParse({
        products: [],
    });
    expect(result.success).toBeFalse();
});

// ============ SearchSuccessResponseSchema 测试 ============

console.log('\n🔍 SearchSuccessResponseSchema 测试\n');

const validSearchResponse = {
    productName: { value: '安心无忧医疗险', sourceClauseId: 12 },
    overview: { value: '一款百万医疗险', sourceClauseId: 12 },
    coreCoverage: [
        { title: '住院医疗', value: '最高600万', desc: '含住院费用', sourceClauseId: 12 },
    ],
    exclusions: [
        { value: '既往症不保', sourceClauseId: 13 },
    ],
    targetAudience: { value: '18-60岁健康人群', sourceClauseId: 12 },
    salesScript: ['这是一款高性价比医疗险', '适合家庭投保'],
    rawTerms: '原始条款内容...',
    sources: [{ clauseId: 12, productName: '安心无忧医疗险' }],
    clauseMap: {
        12: { snippet: '条款片段...', productName: '安心无忧医疗险' },
    },
};

test('正常搜索响应应通过', () => {
    const result = SearchSuccessResponseSchema.safeParse(validSearchResponse);
    expect(result.success).toBeTrue();
});

test('带 _cached 标记应通过', () => {
    const result = SearchSuccessResponseSchema.safeParse({
        ...validSearchResponse,
        _cached: true,
    });
    expect(result.success).toBeTrue();
});

test('带 debug 字段应通过', () => {
    const result = SearchSuccessResponseSchema.safeParse({
        ...validSearchResponse,
        _debugUsedFallback: false,
        _debugContext: 'context...',
        _debugMatches: [],
    });
    expect(result.success).toBeTrue();
});

test('sourceClauseId 为 null 应通过', () => {
    const result = SearchSuccessResponseSchema.safeParse({
        ...validSearchResponse,
        productName: { value: '产品名', sourceClauseId: null },
    });
    expect(result.success).toBeTrue();
});

test('缺少 productName 应拒绝', () => {
    const { productName, ...rest } = validSearchResponse;
    const result = SearchSuccessResponseSchema.safeParse(rest);
    expect(result.success).toBeFalse();
});

test('coreCoverage 非数组应拒绝', () => {
    const result = SearchSuccessResponseSchema.safeParse({
        ...validSearchResponse,
        coreCoverage: 'not an array',
    });
    expect(result.success).toBeFalse();
});

test('salesScript 元素非字符串应拒绝', () => {
    const result = SearchSuccessResponseSchema.safeParse({
        ...validSearchResponse,
        salesScript: [123, 456],
    });
    expect(result.success).toBeFalse();
});

// ============ SearchRequestSchema 测试 ============

console.log('\n🔎 SearchRequestSchema 测试\n');

test('正常搜索请求应通过', () => {
    const result = SearchRequestSchema.safeParse({
        query: '安心无忧医疗险',
    });
    expect(result.success).toBeTrue();
});

test('带可选参数应通过', () => {
    const result = SearchRequestSchema.safeParse({
        query: '安心无忧',
        matchCount: 5,
        matchThreshold: 0.5,
        debug: true,
    });
    expect(result.success).toBeTrue();
});

test('空 query 应拒绝', () => {
    const result = SearchRequestSchema.safeParse({
        query: '',
    });
    expect(result.success).toBeFalse();
});

test('matchCount 超出范围 (>50) 应拒绝', () => {
    const result = SearchRequestSchema.safeParse({
        query: '产品名',
        matchCount: 100,
    });
    expect(result.success).toBeFalse();
});

test('matchThreshold 超出范围 (>1) 应拒绝', () => {
    const result = SearchRequestSchema.safeParse({
        query: '产品名',
        matchThreshold: 1.5,
    });
    expect(result.success).toBeFalse();
});

// ============ ProductToggleRequestSchema 测试 ============

console.log('\n🔄 ProductToggleRequestSchema 测试\n');

test('正常切换请求应通过', () => {
    const result = ProductToggleRequestSchema.safeParse({
        productId: 1,
        active: true,
    });
    expect(result.success).toBeTrue();
});

test('带 notes 应通过', () => {
    const result = ProductToggleRequestSchema.safeParse({
        productId: 1,
        active: false,
        notes: '产品下架原因',
    });
    expect(result.success).toBeTrue();
});

test('productId 为负数应拒绝', () => {
    const result = ProductToggleRequestSchema.safeParse({
        productId: -1,
        active: true,
    });
    expect(result.success).toBeFalse();
});

test('productId 为小数应拒绝', () => {
    const result = ProductToggleRequestSchema.safeParse({
        productId: 1.5,
        active: true,
    });
    expect(result.success).toBeFalse();
});

test('notes 超长 (>500字) 应拒绝', () => {
    const result = ProductToggleRequestSchema.safeParse({
        productId: 1,
        active: true,
        notes: 'a'.repeat(501),
    });
    expect(result.success).toBeFalse();
});

// ============ 测试结果汇总 ============

console.log('\n' + '='.repeat(50));
console.log(`📊 测试结果: ${passCount} 通过, ${failCount} 失败`);
console.log('='.repeat(50) + '\n');

if (failCount > 0) {
    process.exit(1);
} else {
    console.log('🎉 所有测试通过！\n');
    process.exit(0);
}
