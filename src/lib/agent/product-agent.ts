import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { SupabaseClient } from '@supabase/supabase-js';
import { embedText } from '@/lib/embeddings';

type JsonObject = Record<string, unknown>;

interface ProductRow {
  id: number;
  name: string;
  description?: string | null;
  is_active?: boolean | null;
}

interface ClauseRow {
  id: number;
  product_id: number | null;
  content: string | null;
}

export interface AgentSource {
  clauseId: number;
  productName: string;
  snippet: string;
  score: number;
}

export interface AgentStep {
  label: string;
  status: 'done' | 'warning' | 'error';
  detail: string;
}

interface ProductEvidence {
  product: ProductRow;
  clauses: ClauseRow[];
  allowedIds: Set<number>;
}

interface RetrievalTarget {
  label: string;
  query: string;
  keywords: RegExp[];
}

export interface RetrievalProbe {
  label: string;
  query: string;
  strategy: 'semantic_keyword' | 'semantic' | 'keyword_fallback' | 'missing';
  matchedClauseIds: number[];
  coverage: 'hit' | 'partial' | 'missing';
  rationale: string;
}

export interface RetrievalStats {
  probeCount: number;
  candidateClauses: number;
  selectedClauses: number;
  coverage: number;
  contextReduction: number;
}

interface RetrievedEvidence {
  evidence: ProductEvidence;
  probes: RetrievalProbe[];
  stats: RetrievalStats;
}

interface AskHistoryTurn {
  question: string;
  answer: string;
}

const DEFAULT_MODEL = process.env.GENERATION_MODEL || 'gpt-4o-mini';
const CONTEXT_MAX_CHARS_PER_PRODUCT = 7000;
const AGENT_RETRIEVAL_TOP_K = Number(process.env.AGENT_RETRIEVAL_TOP_K || '2');
const AGENT_RETRIEVAL_THRESHOLD = Number(process.env.AGENT_RETRIEVAL_THRESHOLD || '0.15');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\u3000]/g, '')
    .replace(/[()（）［］【】\[\]·•．・。、，,._/:'""-]+/g, '');
}

function loadAliases(): Record<string, string[]> {
  const aliasesPath = path.join(process.cwd(), 'data', 'product-aliases.json');
  if (!fs.existsSync(aliasesPath)) return {};

  try {
    const raw = JSON.parse(fs.readFileSync(aliasesPath, 'utf-8')) as Record<string, { aliases?: string[] }>;
    return Object.fromEntries(
      Object.entries(raw).map(([name, info]) => [name, info.aliases || []])
    );
  } catch {
    return {};
  }
}

async function getProducts(supabase: SupabaseClient): Promise<ProductRow[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, description, is_active')
    .order('id', { ascending: true });

  if (error) throw new Error(`产品列表读取失败: ${error.message}`);
  return data || [];
}

export async function resolveProduct(
  supabase: SupabaseClient,
  productName: string
): Promise<ProductRow | null> {
  const products = await getProducts(supabase);
  const aliases = loadAliases();
  const queryNorm = normalizeName(productName);

  const candidates = products.map((product) => {
    const names = [product.name, ...(aliases[product.name] || [])];
    let best = 0;

    for (const name of names) {
      const nameNorm = normalizeName(name);
      if (nameNorm === queryNorm) best = Math.max(best, 100);
      else if (nameNorm.includes(queryNorm) || queryNorm.includes(nameNorm)) best = Math.max(best, 80);
      else if (queryNorm.length >= 4 && nameNorm.includes(queryNorm.slice(0, 4))) best = Math.max(best, 50);
    }

    return { product, score: best };
  });

  const match = candidates
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.product.is_active) - Number(a.product.is_active))[0];

  return match?.product || null;
}

async function fetchEvidence(
  supabase: SupabaseClient,
  productName: string
): Promise<ProductEvidence> {
  const product = await resolveProduct(supabase, productName);
  if (!product) {
    throw new Error(`未找到产品: ${productName}`);
  }

  const { data, error } = await supabase
    .from('clauses')
    .select('id, product_id, content')
    .eq('product_id', product.id)
    .order('id', { ascending: true });

  if (error) throw new Error(`条款读取失败: ${error.message}`);

  const clauses = (data || []).filter((clause) => Boolean(clause.content?.trim()));
  return {
    product,
    clauses,
    allowedIds: new Set(clauses.map((clause) => clause.id)),
  };
}

function buildContext(evidence: ProductEvidence): string {
  const parts: string[] = [];
  let total = 0;

  for (const clause of evidence.clauses) {
    const content = (clause.content || '').trim();
    if (!content) continue;

    const block = `【产品】${evidence.product.name} 条款ID#${clause.id}\n${content}`;
    if (total + block.length > CONTEXT_MAX_CHARS_PER_PRODUCT) break;
    parts.push(block);
    total += block.length;
  }

  return parts.join('\n\n---\n\n');
}

function getClauseById(evidences: ProductEvidence[]): Map<number, { productName: string; content: string }> {
  const map = new Map<number, { productName: string; content: string }>();
  for (const evidence of evidences) {
    for (const clause of evidence.clauses) {
      map.set(clause.id, {
        productName: evidence.product.name,
        content: clause.content || '',
      });
    }
  }
  return map;
}

function sanitizeIds(ids: unknown, allowedIds: Set<number>, fallback: number[] = []): number[] {
  const raw = Array.isArray(ids) ? ids : [];
  const cleaned = raw
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && allowedIds.has(id));

  if (cleaned.length > 0) return Array.from(new Set(cleaned)).slice(0, 3);
  return fallback.filter((id) => allowedIds.has(id)).slice(0, 2);
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          return normalizeString(record.value || record.question || record.text || record.title).trim();
        }
        return String(item || '').trim();
      })
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function normalizeString(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).join(' ');
  if (typeof value === 'string') return value;
  return '';
}

function firstSentence(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '条款未说明';
  const match = normalized.match(/^(.+?[。！？!?])/);
  return (match?.[1] || normalized).slice(0, 140);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeRiskLevel(value: unknown): 'low' | 'medium' | 'high' {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'high') return 'high';
  if (normalized === 'medium') return 'medium';
  return 'low';
}

function normalizeStatus(value: unknown): 'found' | 'missing' | 'risk' {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'present' || normalized === 'found') return 'found';
  if (normalized === 'risk') return 'risk';
  return 'missing';
}

function explainTargets(productName: string): RetrievalTarget[] {
  return [
    {
      label: '产品定位',
      query: `${productName} 面向谁 适合人群 产品定位 投保年龄`,
      keywords: [/产品定位|适合|人群|投保年龄|周岁|家庭|个人/],
    },
    {
      label: '核心保障',
      query: `${productName} 核心保障 保障责任 报销 给付 保额`,
      keywords: [/核心责任|保障责任|保障额度|报销|给付|保额|医疗费用|重大疾病/],
    },
    {
      label: '免责除外',
      query: `${productName} 免责条款 除外责任 不赔 不予赔付`,
      keywords: [/除外责任|免责|责任免除|不予赔付|不承担|不在保障范围/],
    },
    {
      label: '等待期和续保',
      query: `${productName} 等待期 续保 保证续保 审核`,
      keywords: [/等待期|续保|保证续保|非保证续保|续保审核/],
    },
    {
      label: '赔付限制',
      query: `${productName} 免赔额 赔付比例 限额 年度额度`,
      keywords: [/免赔额|赔付|比例|限额|额度|年度|社保目录/],
    },
  ];
}

function askTargets(productName: string, question: string): RetrievalTarget[] {
  const keywords = questionKeywords(question);
  const isExclusionQuestion = /免责|除外|不赔|不予|既往|先天|遗传|酒驾|毒驾/.test(question);
  const targets: RetrievalTarget[] = [
    {
      label: '用户问题',
      query: `${productName} ${question}`,
      keywords,
    },
  ];

  if (!isExclusionQuestion && /赔|报销|给付|免赔|限额|额度|比例|理赔/.test(question)) {
    targets.push({
      label: '赔付依据',
      query: `${productName} ${question} 赔付 报销 给付 免赔额 限额`,
      keywords: [/赔付|报销|给付|免赔额|限额|额度|比例|保额|医疗费用/],
    });
  }

  if (isExclusionQuestion) {
    targets.push({
      label: '免责限制',
      query: `${productName} ${question} 免责 除外责任 不予赔付`,
      keywords: [/除外责任|免责|责任免除|不予赔付|不承担|不在保障范围|既往症|先天性|遗传性/],
    });
  }

  if (/等待|观察期|续保|保证|审核/.test(question)) {
    targets.push({
      label: '等待续保',
      query: `${productName} ${question} 等待期 续保 保证续保 审核`,
      keywords: [/等待期|观察期|续保|保证续保|非保证续保|审核同意|拒绝续保/],
    });
  }

  if (/健康告知|核保|慢性病|高血压|糖尿病|加费|除外承保/.test(question)) {
    targets.push({
      label: '健康核保',
      query: `${productName} ${question} 健康告知 人工核保 慢性病 加费 除外承保`,
      keywords: [/健康告知|人工核保|慢性病|高血压|糖尿病|加费承保|除外承保/],
    });
  }

  return targets;
}

function buildAskHistoryContext(history: AskHistoryTurn[] = []): string {
  const recent = history
    .filter((turn) => turn.question?.trim() && turn.answer?.trim())
    .slice(-4);

  if (!recent.length) return '无';

  return recent
    .map((turn, index) => `第 ${index + 1} 轮\n问：${turn.question.trim()}\n答：${turn.answer.trim().slice(0, 220)}`)
    .join('\n\n');
}

function buildContextualQuestion(question: string, history: AskHistoryTurn[] = []): string {
  const recent = history.slice(-2).map((turn) => `${turn.question} ${turn.answer}`).join(' ');
  return [recent, question].filter(Boolean).join(' ');
}

function questionKeywords(question: string): RegExp[] {
  const domainKeywords = [
    /等待期|观察期/,
    /续保|保证续保|非保证续保/,
    /免责|除外|责任免除|不赔|不予赔付|不承担/,
    /既往症|既往病|既往病史/,
    /免赔额|赔付|报销|给付|限额|额度|比例|保额/,
    /外购药|进口药|自费药|社保目录/,
    /住院|门诊|特殊门诊|门诊手术|急诊/,
    /年龄|周岁|投保年龄|承保年龄/,
    /重疾|中症|轻症|恶性肿瘤/,
    /健康告知|人工核保|慢性病|高血压|糖尿病|加费承保|除外承保/,
  ];

  const matched = domainKeywords.filter((pattern) => pattern.test(question));
  const compact = question
    .replace(/[，。！？、；：""''【】（）()]/g, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 12)
    .slice(0, 4)
    .map((item) => new RegExp(escapeRegex(item)));

  return [...matched, ...compact].length > 0 ? [...matched, ...compact] : [/条款|责任|保障|赔付|限制/];
}

function compareTargets(productName: string, dimensions: string[]): RetrievalTarget[] {
  return dimensions.map((dimension) => ({
    label: `${productName} · ${dimension}`,
    query: `${productName} ${dimension} 保险条款 原文依据`,
    keywords: dimensionKeywords(dimension),
  }));
}

function dimensionKeywords(dimension: string): RegExp[] {
  if (dimension.includes('定位') || dimension.includes('人群')) {
    return [/产品定位|适合|人群|投保年龄|周岁|家庭|个人/];
  }
  if (dimension.includes('保障')) {
    return [/核心责任|保障责任|保障额度|报销|给付|保额|医疗费用|重大疾病/];
  }
  if (dimension.includes('等待')) {
    return [/等待期|观察期/];
  }
  if (dimension.includes('免责')) {
    return [/除外责任|免责|责任免除|不予赔付|不承担|不在保障范围/];
  }
  if (dimension.includes('风险')) {
    return [/除外责任|免责|等待期|非保证续保|免赔额|限额|既往症|拒绝续保/];
  }
  return [/条款|责任|保障|赔付/];
}

function keywordHitCount(content: string, keywords: RegExp[]): number {
  return keywords.reduce((count, keyword) => count + (keyword.test(content) ? 1 : 0), 0);
}

function targetTitleBoost(content: string, label: string): number {
  const titleText = Array.from(content.matchAll(/【([^】]+)】/g)).map((match) => match[1]).join(' ');
  const labelCore = label.split('·').pop()?.trim() || label;

  if (!titleText) return 0;
  if (labelCore.includes('等待') && /等待期/.test(titleText)) return 4;
  if (labelCore.includes('免责') && /除外|免责|责任免除/.test(titleText)) return 4;
  if (labelCore.includes('续保') && /续保/.test(titleText)) return 4;
  if (labelCore.includes('定位') && /产品定位/.test(titleText)) return 4;
  if (labelCore.includes('保障') && /核心责任|保障额度|保障责任/.test(titleText)) return 4;
  if (labelCore.includes('赔付') && /保障额度|核心责任|赔付|给付/.test(titleText)) return 4;
  if (labelCore.includes('风险') && /除外责任|等待期|续保条款|保障额度|重疾责任/.test(titleText)) return 2;
  if (labelCore.includes('核保') && /健康告知|核保/.test(titleText)) return 4;

  return 0;
}

async function retrieveProbe(
  supabase: SupabaseClient,
  evidence: ProductEvidence,
  target: RetrievalTarget
): Promise<{ probe: RetrievalProbe; clauses: ClauseRow[] }> {
  const byId = new Map(evidence.clauses.map((clause) => [clause.id, clause]));
  const ranked = new Map<number, { clause: ClauseRow; score: number; semantic: boolean; keyword: boolean }>();

  try {
    const embedding = await embedText(target.query);
    const { data, error } = await supabase.rpc('match_clauses', {
      query_embedding: embedding,
      match_threshold: AGENT_RETRIEVAL_THRESHOLD,
      match_count: AGENT_RETRIEVAL_TOP_K * 6,
    });

    if (!error && Array.isArray(data)) {
      for (const row of data as Array<ClauseRow & { similarity?: number }>) {
        if (row.product_id !== evidence.product.id || !byId.has(row.id)) continue;
        const clause = byId.get(row.id)!;
        ranked.set(row.id, {
          clause,
          score: row.similarity || 0.65,
          semantic: true,
          keyword: false,
        });
      }
    }
  } catch {
    // Embedding/RPC 失败时降级到关键词召回，前端仍会展示为 fallback。
  }

  for (const clause of evidence.clauses) {
    const content = clause.content || '';
    const hits = keywordHitCount(content, target.keywords) + targetTitleBoost(content, target.label);
    if (hits === 0) continue;

    const existing = ranked.get(clause.id);
    ranked.set(clause.id, {
      clause,
      score: Math.max(existing?.score || 0, 0.72 + hits * 0.04),
      semantic: Boolean(existing?.semantic),
      keyword: true,
    });
  }

  const rankedValues = Array.from(ranked.values());
  const keywordMatches = rankedValues.filter((match) => match.keyword);
  const pool = keywordMatches.length > 0 ? keywordMatches : rankedValues;
  const matches = pool
    .sort((a, b) => b.score - a.score || a.clause.id - b.clause.id)
    .slice(0, AGENT_RETRIEVAL_TOP_K);

  const hasSemantic = matches.some((match) => match.semantic);
  const hasKeyword = matches.some((match) => match.keyword);
  const strategy = matches.length === 0
    ? 'missing'
    : hasSemantic && hasKeyword
      ? 'semantic_keyword'
      : hasSemantic
        ? 'semantic'
        : 'keyword_fallback';

  const coverage = matches.length === 0 ? 'missing' : hasKeyword ? 'hit' : 'partial';

  return {
    probe: {
      label: target.label,
      query: target.query,
      strategy,
      matchedClauseIds: matches.map((match) => match.clause.id),
      coverage,
      rationale: matches.length
        ? `从 ${evidence.clauses.length} 条候选条款中选中 ${matches.length} 条相关证据`
        : `没有找到与「${target.label}」直接相关的条款`,
    },
    clauses: matches.map((match) => match.clause),
  };
}

async function retrieveEvidence(
  supabase: SupabaseClient,
  evidence: ProductEvidence,
  targets: RetrievalTarget[]
): Promise<RetrievedEvidence> {
  const results = await Promise.all(targets.map((target) => retrieveProbe(supabase, evidence, target)));
  const selectedIds: number[] = [];

  for (const result of results) {
    for (const clause of result.clauses) {
      if (!selectedIds.includes(clause.id)) selectedIds.push(clause.id);
    }
  }

  const fallbackIds = evidence.clauses.slice(0, AGENT_RETRIEVAL_TOP_K).map((clause) => clause.id);
  const finalIds = selectedIds.length > 0 ? selectedIds : fallbackIds;
  const selectedClauses = finalIds
    .map((id) => evidence.clauses.find((clause) => clause.id === id))
    .filter(Boolean) as ClauseRow[];

  const hitCount = results.filter((result) => result.probe.coverage !== 'missing').length;
  const stats = {
    probeCount: targets.length,
    candidateClauses: evidence.clauses.length,
    selectedClauses: selectedClauses.length,
    coverage: targets.length ? Number((hitCount / targets.length).toFixed(2)) : 0,
    contextReduction: evidence.clauses.length
      ? Number((1 - selectedClauses.length / evidence.clauses.length).toFixed(2))
      : 0,
  };

  return {
    evidence: {
      ...evidence,
      clauses: selectedClauses,
      allowedIds: new Set(selectedClauses.map((clause) => clause.id)),
    },
    probes: results.map((result) => result.probe),
    stats,
  };
}

function mergeRetrievedEvidence(retrieved: RetrievedEvidence[]): { probes: RetrievalProbe[]; stats: RetrievalStats } {
  const probeCount = retrieved.reduce((sum, item) => sum + item.stats.probeCount, 0);
  const candidateClauses = retrieved.reduce((sum, item) => sum + item.stats.candidateClauses, 0);
  const selectedClauses = retrieved.reduce((sum, item) => sum + item.stats.selectedClauses, 0);
  const hitCount = retrieved.flatMap((item) => item.probes).filter((probe) => probe.coverage !== 'missing').length;

  return {
    probes: retrieved.flatMap((item) => item.probes),
    stats: {
      probeCount,
      candidateClauses,
      selectedClauses,
      coverage: probeCount ? Number((hitCount / probeCount).toFixed(2)) : 0,
      contextReduction: candidateClauses ? Number((1 - selectedClauses / candidateClauses).toFixed(2)) : 0,
    },
  };
}

function collectSources(ids: number[], clauseMap: Map<number, { productName: string; content: string }>): AgentSource[] {
  return Array.from(new Set(ids))
    .map((id, index) => {
      const clause = clauseMap.get(id);
      if (!clause) return null;
      return {
        clauseId: id,
        productName: clause.productName,
        snippet: clause.content.slice(0, 1200),
        score: Number((0.95 - index * 0.04).toFixed(2)),
      };
    })
    .filter(Boolean) as AgentSource[];
}

async function generateJson<T extends JsonObject>(systemPrompt: string, userPrompt: string): Promise<T> {
  const response = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content?.trim() || '{}';
  return JSON.parse(content) as T;
}

function baseSteps(
  kind: 'ask' | 'explain' | 'compare' | 'audit',
  evidenceCount: number,
  warning?: string,
  retrievalStats?: RetrievalStats
): AgentStep[] {
  const middle = kind === 'compare'
    ? '分别查找每个产品的条款证据'
    : kind === 'audit'
      ? '检查高风险条款和缺失信息'
      : kind === 'ask'
        ? '围绕用户问题查找相关条款'
        : '整理保障、免责和适合人群';
  const retrievalDetail = retrievalStats
    ? `${middle}，按 ${retrievalStats.probeCount} 个查找方向，重点引用 ${retrievalStats.selectedClauses}/${retrievalStats.candidateClauses} 条依据`
    : `${middle}，共找到 ${evidenceCount} 条证据`;

  return [
    { label: '识别产品', status: 'done', detail: '已匹配知识库中的产品名称和别名' },
    { label: '查找依据', status: evidenceCount > 0 ? 'done' : 'warning', detail: retrievalDetail },
    { label: '筛选依据', status: 'done', detail: retrievalStats ? `已查看 ${retrievalStats.candidateClauses} 条条款，重点引用 ${retrievalStats.selectedClauses} 条` : '只保留与结论相关的原文片段' },
    { label: '检查引用', status: warning ? 'warning' : 'done', detail: warning || '结论已绑定到原文条款' },
    { label: '生成结论', status: 'done', detail: '输出为普通用户可读的结构化结果' },
  ];
}

export async function askProductQuestion(
  supabase: SupabaseClient,
  productName: string,
  question: string,
  history: AskHistoryTurn[] = []
) {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) throw new Error('请输入问题');

  const fullEvidence = await fetchEvidence(supabase, productName);
  const contextualQuestion = buildContextualQuestion(trimmedQuestion, history);
  const retrieved = await retrieveEvidence(
    supabase,
    fullEvidence,
    askTargets(fullEvidence.product.name, contextualQuestion)
  );
  const evidence = retrieved.evidence;
  const fallbackIds = evidence.clauses.slice(0, 3).map((clause) => clause.id);

  const result = await generateJson<{
    shortAnswer?: string;
    answer?: string;
    answerSourceClauseIds?: number[];
    keyPoints?: Array<{ value?: string; sourceClauseIds?: number[] }>;
    caveats?: Array<{ value?: string; sourceClauseIds?: number[] }>;
    followUps?: string[];
    nextActions?: string[];
  }>(
    '你是保险条款问答助理。只基于给定条款回答用户问题，面向普通用户，语言直接清楚。没有证据就写“条款未说明”，不要编造。输出 JSON。回答必须全中文。如果问题涉及高血压、糖尿病、慢性病，要区分“投保核保”和“理赔赔付”，不要在条款没有写明时把慢性病直接断言为既往症。',
    `产品：${evidence.product.name}\n用户当前问题：${trimmedQuestion}\n\n同一产品的近期追问：\n${buildAskHistoryContext(history)}\n\n以下条款是 RAG 按用户问题检索后选中的证据，不是完整产品全文。请只使用这些证据作答。\n\n条款上下文：\n${buildContext(evidence)}\n\n输出 JSON：shortAnswer, answer, answerSourceClauseIds, keyPoints[{value,sourceClauseIds}], caveats[{value,sourceClauseIds}], followUps[], nextActions[]。\n\n要求：shortAnswer 用一句人话直接给结论；nextActions 给 1-3 条购买/咨询前下一步行动。`
  );

  const usedIds: number[] = [];
  const answerSourceClauseIds = sanitizeIds(result.answerSourceClauseIds, evidence.allowedIds, fallbackIds);
  usedIds.push(...answerSourceClauseIds);

  const normalizeList = <T extends { sourceClauseIds?: number[] }>(items: T[] = []): T[] => items.map((item) => {
    const ids = sanitizeIds(item.sourceClauseIds, evidence.allowedIds, answerSourceClauseIds.length ? answerSourceClauseIds : fallbackIds);
    usedIds.push(...ids);
    return { ...item, sourceClauseIds: ids };
  });

  const keyPoints = normalizeList(result.keyPoints);
  const caveats = normalizeList(result.caveats);
  const warning = retrieved.stats.coverage === 0 ? '没有找到直接相关条款，回答仅能提示条款未说明。' : undefined;
  const answer = result.answer || '条款未说明';
  const shortAnswer = normalizeString(result.shortAnswer) || firstSentence(answer);

  return {
    mode: 'ask',
    productName: evidence.product.name,
    question: trimmedQuestion,
    shortAnswer,
    answer,
    answerSourceClauseIds,
    keyPoints,
    caveats,
    followUps: normalizeStringList(result.followUps),
    nextActions: normalizeStringList(result.nextActions),
    sources: collectSources(usedIds.length ? usedIds : fallbackIds, getClauseById([evidence])),
    retrievalPlan: retrieved.probes,
    retrievalStats: retrieved.stats,
    agentSteps: baseSteps('ask', evidence.clauses.length, warning, retrieved.stats),
  };
}

export async function explainProduct(supabase: SupabaseClient, productName: string) {
  const fullEvidence = await fetchEvidence(supabase, productName);
  const retrieved = await retrieveEvidence(supabase, fullEvidence, explainTargets(fullEvidence.product.name));
  const evidence = retrieved.evidence;
  const fallbackIds = evidence.clauses.slice(0, 3).map((clause) => clause.id);

  const result = await generateJson<{
    summary?: string;
    suitableFor?: string;
    coverages?: Array<{ title?: string; value?: string; sourceClauseIds?: number[] }>;
    exclusions?: Array<{ value?: string; sourceClauseIds?: number[] }>;
    warnings?: Array<{ value?: string; sourceClauseIds?: number[] }>;
  }>(
    '你是保险条款解读助理。只基于给定条款输出 JSON，面向普通用户，语言简洁。没有证据就写“条款未说明”，不要编造。',
    `产品：${evidence.product.name}\n\n以下条款是 RAG 检索后选中的证据，不是完整产品全文。请只使用这些证据作答。\n\n条款上下文：\n${buildContext(evidence)}\n\n输出 JSON：summary, suitableFor, coverages[{title,value,sourceClauseIds}], exclusions[{value,sourceClauseIds}], warnings[{value,sourceClauseIds}]。`
  );

  const usedIds: number[] = [];
  const normalizeList = <T extends { sourceClauseIds?: number[] }>(items: T[] = []): T[] => items.map((item) => {
    const ids = sanitizeIds(item.sourceClauseIds, evidence.allowedIds, fallbackIds);
    usedIds.push(...ids);
    return { ...item, sourceClauseIds: ids };
  });

  const coverages = normalizeList(result.coverages);
  const exclusions = normalizeList(result.exclusions);
  const warnings = normalizeList(result.warnings);
  const sources = collectSources(usedIds.length ? usedIds : fallbackIds, getClauseById([evidence]));

  return {
    mode: 'explain',
    productName: evidence.product.name,
    summary: result.summary || '条款未说明',
    suitableFor: result.suitableFor || '条款未说明',
    coverages,
    exclusions,
    warnings,
    sources,
    retrievalPlan: retrieved.probes,
    retrievalStats: retrieved.stats,
    agentSteps: baseSteps('explain', evidence.clauses.length, undefined, retrieved.stats),
  };
}

export async function compareProducts(supabase: SupabaseClient, productNames: string[], userProfile = '') {
  if (productNames.length < 2) throw new Error('至少需要选择两个产品');

  const fullEvidences = await Promise.all(productNames.slice(0, 2).map((name) => fetchEvidence(supabase, name)));
  const dimensions = ['产品定位', '核心保障', '等待期', '免责条款', '适合人群', '主要风险'];
  const retrievedList = await Promise.all(
    fullEvidences.map((evidence) => retrieveEvidence(
      supabase,
      evidence,
      compareTargets(evidence.product.name, dimensions)
    ))
  );
  const evidences = retrievedList.map((item) => item.evidence);
  const retrievedSummary = mergeRetrievedEvidence(retrievedList);
  const contexts = evidences.map(buildContext).join('\n\n====================\n\n');

  const result = await generateJson<{
    table?: Array<{
      dimension?: string;
      values?: Record<string, { text?: string; sourceClauseIds?: number[] }>;
    }>;
    summary?: string[];
    recommendation?: string;
    warnings?: string[];
    nextActions?: string[];
  }>(
    '你是保险产品对比助理。必须分别基于每个产品自己的条款证据作答。没有证据就写“条款未说明”。输出 JSON，不要 Markdown。',
    `对比产品：${evidences.map((e) => e.product.name).join(' vs ')}\n固定维度：${dimensions.join('、')}\n用户情况：${userProfile.trim() || '用户未提供个人情况，请给通用建议'}\n\n以下条款是每个维度 RAG 检索后选中的证据，不是完整产品全文。请只使用这些证据作答。\n\n条款上下文：\n${contexts}\n\n输出 JSON：table[{dimension, values: {产品名: {text, sourceClauseIds}}}], summary[], recommendation, warnings[], nextActions[]。\n\n要求：recommendation 要优先回答“按用户情况下一步该怎么选/怎么确认”；nextActions 给 1-3 条购买前行动。`
  );

  const clauseMap = getClauseById(evidences);
  const usedIds: number[] = [];

  const table = dimensions.map((dimension) => {
    const rawRow = result.table?.find((row) => row.dimension === dimension);
    const values: Record<string, { text: string; sourceClauseIds: number[] }> = {};

    for (const evidence of evidences) {
      const rawValue = rawRow?.values?.[evidence.product.name];
      const fallback = evidence.clauses.slice(0, 2).map((clause) => clause.id);
      const text = rawValue?.text || '条款未说明';
      const ids = text.includes('条款未说明')
        ? []
        : sanitizeIds(rawValue?.sourceClauseIds, evidence.allowedIds, fallback);
      usedIds.push(...ids);
      values[evidence.product.name] = {
        text,
        sourceClauseIds: ids,
      };
    }

    return { dimension, values };
  });

  const evidenceCoverage = Object.fromEntries(
    evidences.map((evidence) => {
      const productRows = table.map((row) => row.values[evidence.product.name]);
      const covered = productRows.filter((value) => value.sourceClauseIds.length > 0 && value.text !== '条款未说明').length;
      return [evidence.product.name, Number((covered / productRows.length).toFixed(2))];
    })
  );

  const warnings = [
    ...(result.warnings || []),
    ...Object.entries(evidenceCoverage)
      .filter(([, coverage]) => Number(coverage) < 0.5)
      .map(([name]) => `${name} 的证据覆盖不足，建议补充条款后再做强结论。`),
  ];

  return {
    mode: 'compare',
    products: evidences.map((evidence) => evidence.product.name),
    table,
    summary: normalizeStringList(result.summary),
    recommendation: normalizeString(result.recommendation),
    evidenceCoverage,
    warnings,
    nextActions: normalizeStringList(result.nextActions),
    sources: collectSources(usedIds, clauseMap),
    retrievalPlan: retrievedSummary.probes,
    retrievalStats: retrievedSummary.stats,
    agentSteps: baseSteps('compare', evidences.reduce((sum, evidence) => sum + evidence.clauses.length, 0), warnings[0], retrievedSummary.stats),
  };
}

interface AuditRule {
  item: string;
  patterns: RegExp[];
  riskPatterns?: RegExp[];
  defaultRisk: 'low' | 'medium' | 'high';
  missingQuestion: string;
}

const AUDIT_RULES: AuditRule[] = [
  {
    item: '等待期',
    patterns: [/等待期/],
    riskPatterns: [/90天|180天|等待期内|不承担|不予赔付/],
    defaultRisk: 'medium',
    missingQuestion: '等待期是多久？意外、续保或特定疾病是否有不同规则？',
  },
  {
    item: '免责条款',
    patterns: [/除外责任|免责|责任免除|不予赔付|不承担|不在保障范围/],
    riskPatterns: [/既往症|酒驾|毒驾|犯罪|美容|先天性|遗传性/],
    defaultRisk: 'medium',
    missingQuestion: '哪些情况属于免责或除外责任？是否包含既往症、酒驾、职业限制等？',
  },
  {
    item: '续保条件',
    patterns: [/续保条款|保证续保|非保证续保|续保需|续保条件|续保审核/],
    riskPatterns: [/非保证续保|审核同意|拒绝续保|调整费率|重新核保/],
    defaultRisk: 'medium',
    missingQuestion: '是否保证续保？续保是否需要重新审核或可能调整费率？',
  },
  {
    item: '既往症',
    patterns: [/既往症|既往病|既往病史/],
    riskPatterns: [/不予赔付|除外|不承担|免责/],
    defaultRisk: 'high',
    missingQuestion: '既往症是否赔付？核保通过后是否仍有除外限制？',
  },
  {
    item: '年龄限制',
    patterns: [/周岁|年龄|投保年龄|承保年龄|18-60|0-60|出生满/],
    defaultRisk: 'low',
    missingQuestion: '投保年龄、续保年龄上限分别是多少？',
  },
  {
    item: '赔付限制',
    patterns: [/免赔额|赔付|报销|给付|限额|额度|比例|保额/],
    riskPatterns: [/免赔额|限额|比例|社保目录|自费|年度/],
    defaultRisk: 'medium',
    missingQuestion: '免赔额、赔付比例、年度限额和单项限额分别是多少？',
  },
];

function findMatchingClauses(evidence: ProductEvidence, patterns: RegExp[], limit = 2): ClauseRow[] {
  return evidence.clauses
    .filter((clause) => {
      const content = clause.content || '';
      return patterns.some((pattern) => pattern.test(content));
    })
    .slice(0, limit);
}

function extractRelevantText(content: string, patterns: RegExp[]): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  const sections = normalized.split(/(?=【)/).map((section) => section.trim()).filter(Boolean);
  return sections.find((section) => patterns.some((pattern) => pattern.test(section))) || normalized;
}

function compactText(clauses: ClauseRow[], patterns: RegExp[] = []): string {
  return clauses
    .map((clause) => {
      const content = clause.content || '';
      return patterns.length > 0 ? extractRelevantText(content, patterns) : content.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean)
    .join(' ')
    .slice(0, 220);
}

function buildAuditConclusion(rule: AuditRule, clauses: ClauseRow[], status: 'found' | 'missing' | 'risk'): string {
  if (status === 'missing') {
    return `没有在当前条款中找到${rule.item}的明确说明，建议补充确认。`;
  }

  const snippet = compactText(clauses, rule.patterns);
  if (!snippet) return `已找到${rule.item}相关条款，建议查看原文依据。`;

  if (status === 'risk') {
    return `${rule.item}存在需要重点确认的限制：${snippet}`;
  }

  return `已找到${rule.item}说明：${snippet}`;
}

function deriveSuggestedQuestions(findings: Array<{ item: string; status: 'found' | 'missing' | 'risk' }>): string[] {
  const byItem = new Map(findings.map((finding) => [finding.item, finding.status]));
  const questions: string[] = [];

  for (const rule of AUDIT_RULES) {
    const status = byItem.get(rule.item);
    if (status === 'missing') questions.push(rule.missingQuestion);
    if (status === 'risk' && rule.item === '续保条件') {
      questions.push('哪些情况下保险公司可能不同意续保？是否会因为理赔记录单独调整费率？');
    }
    if (status === 'risk' && rule.item === '免责条款') {
      questions.push('免责条款里哪些情况最容易影响理赔？销售说明是否和条款一致？');
    }
  }

  return questions.slice(0, 6);
}

export async function auditProduct(supabase: SupabaseClient, productName: string) {
  const fullEvidence = await fetchEvidence(supabase, productName);
  const retrieved = await retrieveEvidence(
    supabase,
    fullEvidence,
    AUDIT_RULES.map((rule) => ({
      label: rule.item,
      query: `${fullEvidence.product.name} ${rule.item} 风险 限制 原文依据`,
      keywords: rule.patterns,
    }))
  );
  const evidence = retrieved.evidence;
  const usedIds: number[] = [];
  const fallbackIds = evidence.clauses.slice(0, 3).map((clause) => clause.id);

  const findings = AUDIT_RULES.map((rule) => {
    const probe = retrieved.probes.find((item) => item.label === rule.item);
    const probeIds = probe?.matchedClauseIds || [];
    const probeClauses = probeIds
      .map((id) => evidence.clauses.find((clause) => clause.id === id))
      .filter(Boolean) as ClauseRow[];
    const clauses = findMatchingClauses(
      { ...evidence, clauses: probeClauses.length > 0 ? probeClauses : evidence.clauses },
      rule.patterns
    );
    const matchedText = compactText(clauses, rule.patterns);
    const isRisk = Boolean(matchedText && rule.riskPatterns?.some((pattern) => pattern.test(matchedText)));
    const status = normalizeStatus(clauses.length === 0 ? 'missing' : isRisk ? 'risk' : 'found');
    const ids = status === 'missing'
      ? []
      : sanitizeIds(clauses.map((clause) => clause.id), evidence.allowedIds, fallbackIds);
    usedIds.push(...ids);

    return {
      item: rule.item,
      status,
      riskLevel: normalizeRiskLevel(status === 'missing' ? 'medium' : status === 'risk' ? rule.defaultRisk : 'low'),
      conclusion: buildAuditConclusion(rule, clauses, status),
      sourceClauseIds: ids,
    };
  });

  const missingSet = new Set(findings.filter((finding) => finding.status === 'missing').map((finding) => finding.item));
  const missingItems = Array.from(missingSet);

  const riskRank = { low: 1, medium: 2, high: 3 };
  const maxRisk = findings.reduce<'low' | 'medium' | 'high'>((current, finding) => {
    return riskRank[finding.riskLevel] > riskRank[current] ? finding.riskLevel : current;
  }, 'low');

  const warning = missingItems.length > 0 ? `发现 ${missingItems.length} 个条款缺失项` : undefined;

  return {
    mode: 'audit',
    productName: evidence.product.name,
    riskLevel: maxRisk,
    findings,
    missingItems,
    suggestedQuestions: deriveSuggestedQuestions(findings),
    sources: collectSources(usedIds.length ? usedIds : fallbackIds, getClauseById([evidence])),
    retrievalPlan: retrieved.probes,
    retrievalStats: retrieved.stats,
    agentSteps: baseSteps('audit', evidence.clauses.length, warning, retrieved.stats),
  };
}
