/**
 * 评估报告 HTML 生成脚本
 * 
 * 读取 eval_result.json 和历史数据，生成可视化 HTML 报告
 * 
 * 用法：npx tsx scripts/generate-html-report.ts
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
    product_hit_rate?: number;
    details?: any[];
    [key: string]: any;
}

const OUTPUTS_DIR = path.join(process.cwd(), 'outputs');

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

function getStatusColor(value: number, thresholds: { good: number; warn: number }, lowerIsBetter: boolean = false): string {
    if (lowerIsBetter) {
        if (value <= thresholds.good) return '#22c55e'; // green
        if (value <= thresholds.warn) return '#f59e0b'; // yellow
        return '#ef4444'; // red
    } else {
        if (value >= thresholds.good) return '#22c55e';
        if (value >= thresholds.warn) return '#f59e0b';
        return '#ef4444';
    }
}

function generateHtml(result: EvalResult, baseline: EvalResult | null): string {
    const timestamp = result.timestamp || new Date().toISOString();
    const date = timestamp.split('T')[0];

    const errorRate = result.error_rate ?? 0;
    const citationCoverage = result.citation_coverage ?? 0;
    const avgLatency = result.avg_latency_ms ?? 0;
    const p95Latency = result.p95_latency_ms ?? 0;
    const totalCases = result.total_cases ?? 0;
    const passedCases = result.passed_cases ?? 0;

    const errorRateColor = getStatusColor(errorRate, { good: 2, warn: 5 }, true);
    const citationColor = getStatusColor(citationCoverage, { good: 90, warn: 85 }, false);
    const latencyColor = getStatusColor(avgLatency, { good: 2000, warn: 5000 }, true);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RAG 质量评估报告 - ${date}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8fafc;
      color: #1e293b;
      line-height: 1.6;
      padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      text-align: center;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid #e2e8f0;
    }
    h1 { font-size: 2rem; color: #0f172a; margin-bottom: 0.5rem; }
    .subtitle { color: #64748b; font-size: 0.9rem; }
    
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .metric-card {
      background: white;
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      border-left: 4px solid #3b82f6;
    }
    .metric-card h3 {
      font-size: 0.85rem;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }
    .metric-value {
      font-size: 2.5rem;
      font-weight: 700;
    }
    .metric-unit {
      font-size: 1rem;
      color: #64748b;
      margin-left: 0.25rem;
    }
    .metric-diff {
      font-size: 0.85rem;
      margin-top: 0.5rem;
    }
    .diff-positive { color: #22c55e; }
    .diff-negative { color: #ef4444; }
    
    .section {
      background: white;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .section h2 {
      font-size: 1.25rem;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #e2e8f0;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }
    th {
      background: #f8fafc;
      font-weight: 600;
      font-size: 0.85rem;
      color: #64748b;
      text-transform: uppercase;
    }
    tr:hover { background: #f8fafc; }
    
    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .status-pass { background: #dcfce7; color: #166534; }
    .status-fail { background: #fee2e2; color: #991b1b; }
    
    footer {
      text-align: center;
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid #e2e8f0;
      color: #64748b;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📊 RAG 质量评估报告</h1>
      <p class="subtitle">生成时间: ${timestamp}</p>
    </header>
    
    <div class="metrics-grid">
      <div class="metric-card" style="border-left-color: ${errorRateColor}">
        <h3>错误率</h3>
        <div class="metric-value" style="color: ${errorRateColor}">
          ${errorRate.toFixed(1)}<span class="metric-unit">%</span>
        </div>
        ${baseline ? `<div class="metric-diff ${errorRate <= (baseline.error_rate ?? 0) ? 'diff-positive' : 'diff-negative'}">
          vs baseline: ${(baseline.error_rate ?? 0).toFixed(1)}%
        </div>` : ''}
      </div>
      
      <div class="metric-card" style="border-left-color: ${citationColor}">
        <h3>引用覆盖率</h3>
        <div class="metric-value" style="color: ${citationColor}">
          ${citationCoverage.toFixed(1)}<span class="metric-unit">%</span>
        </div>
        ${baseline ? `<div class="metric-diff ${citationCoverage >= (baseline.citation_coverage ?? 0) ? 'diff-positive' : 'diff-negative'}">
          vs baseline: ${(baseline.citation_coverage ?? 0).toFixed(1)}%
        </div>` : ''}
      </div>
      
      <div class="metric-card" style="border-left-color: ${latencyColor}">
        <h3>平均延迟</h3>
        <div class="metric-value" style="color: ${latencyColor}">
          ${avgLatency.toFixed(0)}<span class="metric-unit">ms</span>
        </div>
        <div class="metric-diff">P95: ${p95Latency.toFixed(0)}ms</div>
      </div>
      
      <div class="metric-card">
        <h3>测试用例</h3>
        <div class="metric-value">
          ${passedCases}<span class="metric-unit">/ ${totalCases}</span>
        </div>
        <div class="metric-diff">通过率: ${totalCases > 0 ? ((passedCases / totalCases) * 100).toFixed(1) : 0}%</div>
      </div>
    </div>
    
    <div class="section">
      <h2>📋 质量阈值检查</h2>
      <table>
        <thead>
          <tr>
            <th>指标</th>
            <th>阈值</th>
            <th>当前值</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>错误率</td>
            <td>≤ 5%</td>
            <td>${errorRate.toFixed(1)}%</td>
            <td><span class="status-badge ${errorRate <= 5 ? 'status-pass' : 'status-fail'}">${errorRate <= 5 ? 'PASS' : 'FAIL'}</span></td>
          </tr>
          <tr>
            <td>引用覆盖率</td>
            <td>≥ 85%</td>
            <td>${citationCoverage.toFixed(1)}%</td>
            <td><span class="status-badge ${citationCoverage >= 85 ? 'status-pass' : 'status-fail'}">${citationCoverage >= 85 ? 'PASS' : 'FAIL'}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <footer>
      <p>Insurance RAG Quality Report | Generated by eval-quality.ts</p>
    </footer>
  </div>
</body>
</html>`;
}

async function main() {
    console.log('📄 HTML 报告生成脚本启动...\n');

    // 确保输出目录存在
    if (!fs.existsSync(OUTPUTS_DIR)) {
        fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
    }

    // 加载评估结果
    const resultPath = path.join(OUTPUTS_DIR, 'eval_result.json');
    const result = loadJson(resultPath);

    if (!result) {
        console.log('❌ 未找到评估结果文件');
        console.log(`   请先运行: npm run eval`);
        process.exit(1);
    }

    // 加载 baseline（可选）
    const baselinePath = path.join(OUTPUTS_DIR, 'baseline_quality.json');
    const baseline = loadJson(baselinePath);

    if (baseline) {
        console.log('📊 已加载 baseline 用于对比');
    }

    // 生成 HTML
    const html = generateHtml(result, baseline);

    // 保存文件
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const outputPath = path.join(OUTPUTS_DIR, `report_${date}.html`);

    fs.writeFileSync(outputPath, html, 'utf-8');
    console.log(`✅ 报告已生成: ${outputPath}`);
}

main().catch(err => {
    console.error('❌ 脚本执行失败:', err);
    process.exit(1);
});
