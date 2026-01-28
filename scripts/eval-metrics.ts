/**
 * Metrics-only evaluation script
 *
 * Focus metrics:
 * - field_completeness_rate
 * - citation_coverage_rate
 * - latency_p95_ms
 *
 * Usage: npx tsx scripts/eval-metrics.ts
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

interface SimpleTestCase {
    id?: string;
    product_name?: string;
    name?: string;
    plan_input?: string;
    test_type?: string;
    notes?: string;
}

interface APIResponse {
    productName?: { value: string; sourceClauseId: number | null } | string;
    overview?: { value: string; sourceClauseId: number | null } | string;
    coreCoverage?: { title: string; value: string; desc: string; sourceClauseId: number | null }[];
    exclusions?: { value: string; sourceClauseId: number | null }[];
    targetAudience?: { value: string; sourceClauseId: number | null } | string;
    salesScript?: string[];
    sources?: { clauseId: number; productName: string | null }[];
    clauseMap?: Record<number, { snippet: string; productName: string | null }>;
    notFound?: { query: string; reason: string };
    error?: string;
}

interface MetricsReport {
    timestamp: string;
    total_cases: number;
    success_cases: number;
    error_cases: number;
    metrics: {
        field_completeness_rate: number;
        citation_coverage_rate: number;
        latency_p95_ms: number;
    };
}

const API_URL = process.env.API_URL || 'http://localhost:3000/api/search';
const REQUEST_DELAY_MS = 300;
const REQUIRED_FIELDS = ['productName', 'overview', 'coreCoverage', 'exclusions', 'targetAudience'] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

function getProductName(row: SimpleTestCase): string | null {
    return row.product_name || row.name || row.plan_input || null;
}

function isNonEmptyValue(value?: string): boolean {
    if (!value) return false;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed !== '[条款未说明]';
}

function checkFieldComplete(response: APIResponse, fieldName: RequiredField): boolean {
    const field = (response as any)[fieldName];
    if (!field) return false;

    if (Array.isArray(field)) {
        if (field.length === 0) return false;
        return field.some((item: any) => {
            if (typeof item === 'string') return isNonEmptyValue(item);
            if (item && typeof item === 'object') {
                const candidate = item.value || item.title || item.desc;
                return typeof candidate === 'string' && isNonEmptyValue(candidate);
            }
            return false;
        });
    }

    if (typeof field === 'object' && 'value' in field) {
        return isNonEmptyValue(field.value as string | undefined);
    }

    if (typeof field === 'string') {
        return isNonEmptyValue(field);
    }

    return false;
}

function checkFieldCited(response: APIResponse, fieldName: RequiredField): boolean {
    const field = (response as any)[fieldName];
    if (!field) return false;

    if (Array.isArray(field)) {
        return field.some((item: any) =>
            typeof item === 'object' && item?.sourceClauseId != null
        );
    }

    if (typeof field === 'object' && 'sourceClauseId' in field) {
        return field.sourceClauseId != null;
    }

    return false;
}

function calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
}

async function queryAPI(query: string): Promise<{ response: APIResponse | null; latency: number; error?: string }> {
    const start = Date.now();

    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, matchCount: 10, matchThreshold: 0.1 }),
        });

        const latency = Date.now() - start;

        if (!res.ok) {
            return { response: null, latency, error: `HTTP ${res.status}` };
        }

        const data = await res.json();
        return { response: data, latency };
    } catch (err: any) {
        return { response: null, latency: Date.now() - start, error: err.message };
    }
}

async function runMetrics() {
    const evalSetPath = path.join(process.cwd(), 'data', 'eval_set.csv');
    if (!fs.existsSync(evalSetPath)) {
        console.error(`Missing eval set: ${evalSetPath}`);
        process.exit(1);
    }

    const csvContent = fs.readFileSync(evalSetPath, 'utf-8');
    const rawRows = parse(csvContent, { columns: true, skip_empty_lines: true }) as SimpleTestCase[];

    const productNames = rawRows
        .map(getProductName)
        .filter((name): name is string => !!name);

    if (productNames.length === 0) {
        console.error('No product names found in eval_set.csv');
        process.exit(1);
    }

    const latencies: number[] = [];
    let completenessSum = 0;
    let citationSum = 0;
    let successCases = 0;
    let errorCases = 0;

    for (const productName of productNames) {
        const { response, latency, error } = await queryAPI(productName);

        if (error || !response || response.error || response.notFound) {
            errorCases += 1;
            continue;
        }

        successCases += 1;
        latencies.push(latency);

        const completeCount = REQUIRED_FIELDS.filter((field) =>
            checkFieldComplete(response, field)
        ).length;
        const citedCount = REQUIRED_FIELDS.filter((field) =>
            checkFieldCited(response, field)
        ).length;

        completenessSum += completeCount / REQUIRED_FIELDS.length;
        citationSum += citedCount / REQUIRED_FIELDS.length;

        await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
    }

    const fieldCompletenessRate = successCases > 0
        ? (completenessSum / successCases) * 100
        : 0;
    const citationCoverageRate = successCases > 0
        ? (citationSum / successCases) * 100
        : 0;
    const latencyP95 = calculatePercentile(latencies, 95);

    const report: MetricsReport = {
        timestamp: new Date().toISOString(),
        total_cases: productNames.length,
        success_cases: successCases,
        error_cases: errorCases,
        metrics: {
            field_completeness_rate: Math.round(fieldCompletenessRate * 10) / 10,
            citation_coverage_rate: Math.round(citationCoverageRate * 10) / 10,
            latency_p95_ms: Math.round(latencyP95),
        },
    };

    console.log('Metrics-only report');
    console.log(`field_completeness_rate: ${report.metrics.field_completeness_rate}%`);
    console.log(`citation_coverage_rate: ${report.metrics.citation_coverage_rate}%`);
    console.log(`latency_p95_ms: ${report.metrics.latency_p95_ms}ms`);

    const outputDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const reportPath = path.join(outputDir, `metrics_${timestamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`Report saved: ${reportPath}`);
}

runMetrics().catch((err) => {
    console.error('Metrics evaluation failed:', err);
    process.exit(1);
});
