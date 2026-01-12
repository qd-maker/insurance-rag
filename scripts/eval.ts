import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

interface EvalCase {
    id: string;
    group: string;
    plan_input: string;
    question: string;
    expected_plan: string;
    should_refuse: string;
    notes: string;
}

interface EvalMetrics {
    total: number;
    group_a_accuracy: number; // 精确输入准确率
    group_b_accuracy: number; // 模糊输入准确率
    group_c_refusal_accuracy: number; // 拒答准确率
    overall_accuracy: number;
    citation_completeness: number;
}

interface EvalResult {
    case_id: string;
    group: string;
    query: string;
    expected: string;
    should_refuse: boolean;
    actual_product: string | null;
    actual_refused: boolean;
    has_citations: boolean;
    pass: boolean;
    reason: string;
}

async function queryAPI(planInput: string, question: string): Promise<any> {
    const API_URL = process.env.API_URL || 'http://localhost:3000/api/search';

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: `【${planInput}】${question}`,
                matchCount: 5,
                matchThreshold: 0.1,
            }),
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error(`[Eval] API call failed:`, error);
        return null;
    }
}

function normalizeProductName(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFKC')
        .replace(/[\s\u3000]/g, '')
        .replace(/[()（）［］【】\[\]·•．・。、，,._/:'""-]+/g, '');
}

function evaluateCase(
    testCase: EvalCase,
    apiResponse: any
): EvalResult {
    const shouldRefuse = testCase.should_refuse === '1';
    const expectedProduct = testCase.expected_plan;

    // 检查是否拒答
    const actualRefused =
        apiResponse?.error ||
        apiResponse?.notFound ||
        apiResponse?.shouldRefuse ||
        !apiResponse?.productName;

    // 检查引用
    const hasCitations =
        apiResponse?.sources?.length > 0 ||
        apiResponse?.citations?.length > 0;

    let pass = false;
    let reason = '';

    if (shouldRefuse) {
        // Group C：应该拒答的场景
        pass = actualRefused;
        reason = pass
            ? '✅ 正确拒答'
            : `❌ 应拒答但返回了结果: ${apiResponse?.productName}`;
    } else {
        // Group A/B：应该正确识别产品
        if (actualRefused) {
            pass = false;
            reason = '❌ 不应拒答但拒答了';
        } else {
            const actualProduct = apiResponse?.productName || '';
            const expectedNorm = normalizeProductName(expectedProduct);
            const actualNorm = normalizeProductName(actualProduct);

            const productMatch =
                actualNorm.includes(expectedNorm) || expectedNorm.includes(actualNorm);

            pass = productMatch && hasCitations;

            if (!productMatch) {
                reason = `❌ 产品不匹配: 期望"${expectedProduct}", 实际"${actualProduct}"`;
            } else if (!hasCitations) {
                reason = '❌ 缺少引用来源';
            } else {
                reason = '✅ 产品匹配且有引用';
            }
        }
    }

    return {
        case_id: testCase.id,
        group: testCase.group,
        query: `【${testCase.plan_input}】${testCase.question}`,
        expected: expectedProduct,
        should_refuse: shouldRefuse,
        actual_product: apiResponse?.productName || null,
        actual_refused: actualRefused,
        has_citations: hasCitations,
        pass,
        reason,
    };
}

async function runEvaluation() {
    console.log('🚀 开始评估...\n');

    // 读取测试集
    const evalSetPath = path.join(process.cwd(), 'data', 'eval_set.csv');
    const csvContent = fs.readFileSync(evalSetPath, 'utf-8');
    const testCases: EvalCase[] = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
    });

    console.log(`📋 加载 ${testCases.length} 条测试用例\n`);

    // 逐条执行
    const results: EvalResult[] = [];
    let processed = 0;

    for (const testCase of testCases) {
        processed++;
        console.log(`[${processed}/${testCases.length}] 测试: ${testCase.question}`);

        const apiResponse = await queryAPI(testCase.plan_input, testCase.question);
        const result = evaluateCase(testCase, apiResponse);
        results.push(result);

        console.log(`  ${result.reason}\n`);

        // 避免API限流
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // 计算指标
    const groupA = results.filter((r) => r.group === 'A');
    const groupB = results.filter((r) => r.group === 'B');
    const groupC = results.filter((r) => r.group === 'C');

    const metrics: EvalMetrics = {
        total: results.length,
        group_a_accuracy: groupA.length > 0
            ? (groupA.filter((r) => r.pass).length / groupA.length) * 100
            : 0,
        group_b_accuracy: groupB.length > 0
            ? (groupB.filter((r) => r.pass).length / groupB.length) * 100
            : 0,
        group_c_refusal_accuracy: groupC.length > 0
            ? (groupC.filter((r) => r.pass).length / groupC.length) * 100
            : 0,
        overall_accuracy: (results.filter((r) => r.pass).length / results.length) * 100,
        citation_completeness: results.filter((r) => !r.should_refuse && r.has_citations).length /
            results.filter((r) => !r.should_refuse).length * 100,
    };

    // 输出报告
    console.log('\n' + '='.repeat(60));
    console.log('📊 评估报告');
    console.log('='.repeat(60));
    console.log(`总测试数: ${metrics.total}`);
    console.log(`\nGroup A（精确输入）准确率: ${metrics.group_a_accuracy.toFixed(1)}% (${groupA.filter(r => r.pass).length}/${groupA.length})`);
    console.log(`Group B（模糊输入）准确率: ${metrics.group_b_accuracy.toFixed(1)}% (${groupB.filter(r => r.pass).length}/${groupB.length})`);
    console.log(`Group C（拒答场景）准确率: ${metrics.group_c_refusal_accuracy.toFixed(1)}% (${groupC.filter(r => r.pass).length}/${groupC.length})`);
    console.log(`\n整体准确率: ${metrics.overall_accuracy.toFixed(1)}%`);
    console.log(`引用完整性: ${metrics.citation_completeness.toFixed(1)}%`);
    console.log('='.repeat(60));

    // 失败详情
    const failures = results.filter((r) => !r.pass);
    if (failures.length > 0) {
        console.log('\n❌ 失败案例:');
        failures.forEach((f) => {
            console.log(`  [${f.case_id}] ${f.query}`);
            console.log(`      ${f.reason}`);
        });
    }

    // 保存报告
    const outputDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const reportPath = path.join(outputDir, `eval_result_${timestamp}.json`);

    const report = {
        timestamp: new Date().toISOString(),
        metrics,
        results,
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\n💾 详细报告已保存至: ${reportPath}`);
}

// 执行评估
runEvaluation().catch((error) => {
    console.error('评估失败:', error);
    process.exit(1);
});
