/**
 * Baseline 比较脚本
 * 
 * 比较当前评估结果与 baseline，输出差异报告
 * 
 * 用法：npx tsx scripts/compare-baseline.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface EvalResult {
    timestamp?: string;
    total_cases?: number;
    passed_cases?: number;
    error_rate?: number;
    citation_coverage?: number;
    avg_latency_ms?: number;
    p95_latency_ms?: number;
    [key: string]: any;
}

const BASELINE_PATH = path.join(process.cwd(), 'outputs', 'baseline_quality.json');
const RESULT_PATH = path.join(process.cwd(), 'outputs', 'eval_result.json');

function loadJson(filePath: string): EvalResult | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
        return null;
    }
}

function formatDiff(current: number, baseline: number, lowerIsBetter: boolean = false): string {
    const diff = current - baseline;
    const pct = baseline !== 0 ? ((diff / baseline) * 100).toFixed(1) : 'N/A';

    if (diff === 0) return '→ 0';

    const isPositive = lowerIsBetter ? diff < 0 : diff > 0;
    const arrow = isPositive ? '↑' : '↓';
    const sign = diff > 0 ? '+' : '';

    return `${arrow} ${sign}${diff.toFixed(2)} (${pct}%)`;
}

async function main() {
    console.log('📊 Baseline 比较脚本启动...\n');

    const baseline = loadJson(BASELINE_PATH);
    const current = loadJson(RESULT_PATH);

    if (!baseline) {
        console.log('⚠️ 未找到 baseline 文件，跳过比较');
        console.log(`   请先运行: npm run baseline`);
        process.exit(0);
    }

    if (!current) {
        console.log('❌ 未找到当前评估结果');
        console.log(`   请先运行: npx tsx scripts/eval-quality.ts`);
        process.exit(1);
    }

    console.log('='.repeat(60));
    console.log('📈 Baseline 比较报告');
    console.log('='.repeat(60));

    const metrics = [
        { key: 'error_rate', name: '错误率 (%)', lowerIsBetter: true },
        { key: 'citation_coverage', name: '引用覆盖率 (%)', lowerIsBetter: false },
        { key: 'avg_latency_ms', name: '平均延迟 (ms)', lowerIsBetter: true },
        { key: 'p95_latency_ms', name: 'P95 延迟 (ms)', lowerIsBetter: true },
    ];

    console.log('\n| 指标 | Baseline | Current | Diff |');
    console.log('|------|----------|---------|------|');

    let hasRegression = false;

    for (const { key, name, lowerIsBetter } of metrics) {
        const baseVal = baseline[key] ?? 0;
        const currVal = current[key] ?? 0;
        const diff = formatDiff(currVal, baseVal, lowerIsBetter);

        // 检测退化
        const isRegression = lowerIsBetter
            ? currVal > baseVal * 1.1  // 超过 10% 算退化
            : currVal < baseVal * 0.9; // 低于 10% 算退化

        if (isRegression) {
            hasRegression = true;
            console.log(`| ${name} | ${baseVal} | ${currVal} | ⚠️ ${diff} |`);
        } else {
            console.log(`| ${name} | ${baseVal} | ${currVal} | ${diff} |`);
        }
    }

    console.log('\n' + '='.repeat(60));

    if (hasRegression) {
        console.log('\n⚠️ 检测到质量退化，请检查相关改动');
        process.exit(1);
    } else {
        console.log('\n✅ 质量指标稳定或有所提升');
        process.exit(0);
    }
}

main().catch(err => {
    console.error('❌ 脚本执行失败:', err);
    process.exit(1);
});
