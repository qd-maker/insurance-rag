"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  FileSearch,
  FileText,
  Loader2,
  MessageCircleQuestion,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

type TaskMode = "ask" | "explain" | "compare" | "audit";
type StepStatus = "done" | "warning" | "error";

interface ProductInfo {
  id: number;
  name: string;
  description?: string | null;
  is_active?: boolean;
}

interface AgentSource {
  clauseId: number;
  productName: string;
  snippet: string;
  score: number;
}

interface AgentStep {
  label: string;
  status: StepStatus;
  detail: string;
}

interface RetrievalProbe {
  label: string;
  query: string;
  strategy: "semantic_keyword" | "semantic" | "keyword_fallback" | "missing";
  matchedClauseIds: number[];
  coverage: "hit" | "partial" | "missing";
  rationale: string;
}

interface RetrievalStats {
  probeCount: number;
  candidateClauses: number;
  selectedClauses: number;
  coverage: number;
  contextReduction: number;
}

interface AskResult {
  mode: "ask";
  productName: string;
  question: string;
  shortAnswer: string;
  answer: string;
  answerSourceClauseIds: number[];
  keyPoints: Array<{ value?: string; sourceClauseIds?: number[] }>;
  caveats: Array<{ value?: string; sourceClauseIds?: number[] }>;
  followUps: string[];
  nextActions: string[];
  sources: AgentSource[];
  retrievalPlan: RetrievalProbe[];
  retrievalStats: RetrievalStats;
  agentSteps: AgentStep[];
}

interface ExplainResult {
  mode: "explain";
  productName: string;
  summary: string;
  suitableFor: string;
  coverages: Array<{ title?: string; value?: string; sourceClauseIds?: number[] }>;
  exclusions: Array<{ value?: string; sourceClauseIds?: number[] }>;
  warnings: Array<{ value?: string; sourceClauseIds?: number[] }>;
  sources: AgentSource[];
  retrievalPlan: RetrievalProbe[];
  retrievalStats: RetrievalStats;
  agentSteps: AgentStep[];
}

interface CompareResult {
  mode: "compare";
  products: string[];
  table: Array<{
    dimension: string;
    values: Record<string, { text: string; sourceClauseIds: number[] }>;
  }>;
  summary: string[];
  recommendation: string;
  evidenceCoverage: Record<string, number>;
  warnings: string[];
  nextActions?: string[];
  sources: AgentSource[];
  retrievalPlan: RetrievalProbe[];
  retrievalStats: RetrievalStats;
  agentSteps: AgentStep[];
}

interface AuditResult {
  mode: "audit";
  productName: string;
  riskLevel: "low" | "medium" | "high";
  findings: Array<{
    item: string;
    status: "found" | "missing" | "risk";
    riskLevel: "low" | "medium" | "high";
    conclusion: string;
    sourceClauseIds: number[];
  }>;
  missingItems: string[];
  suggestedQuestions: string[];
  sources: AgentSource[];
  retrievalPlan: RetrievalProbe[];
  retrievalStats: RetrievalStats;
  agentSteps: AgentStep[];
}

type AgentResult = AskResult | ExplainResult | CompareResult | AuditResult;

function isDemoReadyProduct(product: ProductInfo): boolean {
  const name = product.name.trim();
  if (!name || product.is_active === false) return false;
  return !/(测试|无标题|demo|sample|样例)/i.test(name);
}

interface PhaseSpec {
  label: string;
  estimatedMs: number;
}

const taskConfig: Record<TaskMode, {
  title: string;
  shortTitle: string;
  action: string;
  accent: string;
  icon: React.ReactNode;
  loading: string[];
  phases: PhaseSpec[];
}> = {
  ask: {
    title: "深入提问",
    shortTitle: "提问",
    action: "提交问题",
    accent: "blue",
    icon: <MessageCircleQuestion className="h-5 w-5" />,
    loading: ["理解问题", "检索相关条款", "组织答案", "检查引用"],
    phases: [
      { label: "理解问题", estimatedMs: 800 },
      { label: "检索相关条款", estimatedMs: 1800 },
      { label: "组织答案", estimatedMs: 3500 },
      { label: "检查引用", estimatedMs: 900 },
    ],
  },
  explain: {
    title: "解读产品",
    shortTitle: "解读",
    action: "生成解读",
    accent: "blue",
    icon: <ShieldCheck className="h-5 w-5" />,
    loading: ["识别产品", "拆解问题", "检索证据", "检查引用"],
    phases: [
      { label: "识别产品", estimatedMs: 700 },
      { label: "拆解问题", estimatedMs: 1500 },
      { label: "检索证据", estimatedMs: 2400 },
      { label: "生成解读", estimatedMs: 3500 },
    ],
  },
  compare: {
    title: "对比产品",
    shortTitle: "对比",
    action: "开始对比",
    accent: "violet",
    icon: <BarChart3 className="h-5 w-5" />,
    loading: ["识别双方产品", "拆解维度", "分别检索证据", "生成建议"],
    phases: [
      { label: "识别双方产品", estimatedMs: 800 },
      { label: "拆解维度", estimatedMs: 1500 },
      { label: "并行检索证据", estimatedMs: 3000 },
      { label: "生成对比建议", estimatedMs: 4200 },
    ],
  },
  audit: {
    title: "审计风险",
    shortTitle: "审计",
    action: "检查风险",
    accent: "amber",
    icon: <FileSearch className="h-5 w-5" />,
    loading: ["识别产品", "拆解风险项", "检索原文证据", "生成风险报告"],
    phases: [
      { label: "识别产品", estimatedMs: 700 },
      { label: "拆解风险项", estimatedMs: 1400 },
      { label: "检索原文证据", estimatedMs: 2400 },
      { label: "生成风险报告", estimatedMs: 3500 },
    ],
  },
};

const REQUEST_TIMEOUT_MS = 60_000;

export default function ChatPage() {
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [mode, setMode] = useState<TaskMode>("explain");
  const [primaryProduct, setPrimaryProduct] = useState("");
  const [secondaryProduct, setSecondaryProduct] = useState("");
  const [question, setQuestion] = useState("既往症赔不赔？");
  const [askHistory, setAskHistory] = useState<Array<{ question: string; answer: string }>>([]);
  const [userProfile, setUserProfile] = useState("");
  const [result, setResult] = useState<AgentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<AgentSource | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [loadingPhaseIdx, setLoadingPhaseIdx] = useState(0);
  const [loadingElapsedMs, setLoadingElapsedMs] = useState(0);
  const [traceId, setTraceId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const phaseTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearLoadingTimers = React.useCallback(() => {
    phaseTimersRef.current.forEach(clearTimeout);
    phaseTimersRef.current = [];
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearLoadingTimers();
    };
  }, [clearLoadingTimers]);

  useEffect(() => {
    let mounted = true;
    fetch("/api/products/list")
      .then((res) => res.json())
      .then((data: ProductInfo[]) => {
        if (!mounted || !Array.isArray(data)) return;
        const cleanProducts = data.filter(isDemoReadyProduct);
        const active = cleanProducts.length > 0
          ? cleanProducts
          : data.filter((item) => item.is_active !== false);
        setProducts(active);
        setPrimaryProduct(active[0]?.name || "");
        setSecondaryProduct(active.find((item) => item.name !== active[0]?.name)?.name || "");
      })
      .catch(() => setError("产品列表加载失败"))
      .finally(() => {
        if (mounted) setProductsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const selectedConfig = taskConfig[mode];
  const canRun = mode === "compare"
    ? Boolean(primaryProduct && secondaryProduct && primaryProduct !== secondaryProduct)
    : mode === "ask"
      ? Boolean(primaryProduct && question.trim().length >= 2)
      : Boolean(primaryProduct);

  const allSources = result?.sources || [];
  const showRightPanel = showEvidence || activeSource;

  function changePrimaryProduct(value: string) {
    setPrimaryProduct(value);
    setAskHistory([]);
    if (mode === "ask") setResult(null);
  }

  async function runAgentTask(nextMode = mode) {
    setMode(nextMode);
    setError(null);
    setActiveSource(null);
    setShowEvidence(false);
    setTraceId(null);

    if (!canRun && nextMode === mode) {
      setError(nextMode === "compare" ? "请选择两个不同产品" : nextMode === "ask" ? "请输入要问的问题" : "请选择一个产品");
      return;
    }

    const productA = primaryProduct;
    const productB = secondaryProduct;
    const valid = nextMode === "compare"
      ? Boolean(productA && productB && productA !== productB)
      : nextMode === "ask"
        ? Boolean(productA && question.trim().length >= 2)
        : Boolean(productA);

    if (!valid) {
      setError(nextMode === "compare" ? "请选择两个不同产品" : nextMode === "ask" ? "请输入要问的问题" : "请选择一个产品");
      return;
    }

    // 取消任何在飞的旧请求，避免竛态
    abortRef.current?.abort();
    clearLoadingTimers();

    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    setLoading(true);
    setResult(null);
    setLoadingPhaseIdx(0);
    setLoadingElapsedMs(0);

    // 启动渐进式阶段计时器：按 estimatedMs 依次点亮步骤
    const phases = taskConfig[nextMode].phases;
    const phaseStart = Date.now();
    let cumulative = 0;
    phases.forEach((phase, idx) => {
      cumulative += phase.estimatedMs;
      if (idx < phases.length - 1) {
        const handle = setTimeout(() => setLoadingPhaseIdx(idx + 1), cumulative);
        phaseTimersRef.current.push(handle);
      }
    });
    elapsedTimerRef.current = setInterval(() => {
      setLoadingElapsedMs(Date.now() - phaseStart);
    }, 200);

    const endpoint = `/api/agent/${nextMode === "explain" ? "explain" : nextMode}`;
    const body = nextMode === "compare"
      ? { products: [productA, productB], userProfile: userProfile.trim() }
      : nextMode === "ask"
        ? { productName: productA, question: question.trim(), history: askHistory.slice(-4) }
        : { productName: productA };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const incomingTraceId = response.headers.get("X-Trace-Id") || response.headers.get("X-Request-Id");
      if (incomingTraceId) setTraceId(incomingTraceId);
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || data.message || `请求失败 (${response.status})`);
      }
      setResult(data as AgentResult);
      if (data.mode === "ask") {
        setAskHistory((previous) => [
          ...previous,
          { question: data.question, answer: data.shortAnswer || data.answer },
        ].slice(-6));
      }
      const shouldAutoOpenEvidence = window.matchMedia("(min-width: 1024px)").matches;
      setShowEvidence(shouldAutoOpenEvidence && Boolean(data.sources?.length));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        const elapsed = Date.now() - phaseStart;
        setError(elapsed >= REQUEST_TIMEOUT_MS - 500
          ? `请求超过 ${Math.round(REQUEST_TIMEOUT_MS / 1000)} 秒未返回，已取消。请稍后重试或简化问题。`
          : "请求已取消。");
      } else {
        setError(err instanceof Error ? err.message : "请求失败，请稍后重试");
      }
    } finally {
      clearTimeout(timeoutHandle);
      clearLoadingTimers();
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_32%),linear-gradient(135deg,#f8fafc_0%,#eef2ff_50%,#f8fafc_100%)] text-slate-950">
      <div className="mx-auto flex min-h-screen max-w-[1480px] gap-3 p-3">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-xl shadow-slate-200/60 backdrop-blur">
          <TopBar productsCount={products.length} productsLoading={productsLoading} result={result} />

          <div className="flex-1 overflow-y-auto bg-slate-50/70">
            <div className="mx-auto max-w-6xl space-y-4 px-5 py-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                      <Sparkles className="h-3.5 w-3.5" />
                      PolicyGraph Agent
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-950">保险条款分析助理</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                      先把任务拆成检索问题，从知识库命中条款，再回答提问、生成解读、对比或风险审计。
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    {(Object.keys(taskConfig) as TaskMode[]).map((task) => (
                      <TaskButton
                        key={task}
                        mode={task}
                        active={mode === task}
                        onClick={() => setMode(task)}
                      />
                    ))}
                  </div>
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${accentBg(selectedConfig.accent)}`}>
                      {selectedConfig.icon}
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-slate-900">{selectedConfig.title}</h2>
                      <p className="text-xs text-slate-500">已连接 {productsLoading ? "..." : products.length} 个产品</p>
                    </div>
                  </div>

                  {productsLoading ? (
                    <ProductSkeleton />
                  ) : (
                    <div className="space-y-3">
                      <ProductSelect
                        label={mode === "compare" ? "产品 A" : "选择产品"}
                        value={primaryProduct}
                        products={products}
                        onChange={changePrimaryProduct}
                      />
                      {mode === "compare" && (
                        <ProductSelect
                          label="产品 B"
                          value={secondaryProduct}
                          products={products}
                          onChange={setSecondaryProduct}
                        />
                      )}
                      {mode === "ask" && (
                        <QuestionBox
                          value={question}
                          onChange={setQuestion}
                          historyCount={askHistory.length}
                        />
                      )}
                      {mode === "audit" && <AuditChecklist />}
                      {mode === "compare" && (
                        <>
                          <CompareProfile value={userProfile} onChange={setUserProfile} />
                          <CompareDimensions />
                        </>
                      )}
                    </div>
                  )}

                  {error && (
                    <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="flex-1">
                        <p>{error}</p>
                        {traceId && (
                          <p className="mt-1 font-mono text-[10px] text-red-500/80">trace: {traceId}</p>
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => runAgentTask()}
                    disabled={loading || productsLoading || !canRun}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "ask" ? <Send className="h-4 w-4" /> : selectedConfig.icon}
                    {loading ? "处理中..." : selectedConfig.action}
                  </button>
                </div>

                <div className="min-h-[520px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  {loading ? (
                    <LoadingState mode={mode} phaseIdx={loadingPhaseIdx} elapsedMs={loadingElapsedMs} />
                  ) : result ? (
                    <ResultView
                      result={result}
                      onSourceClick={(source) => {
                        setActiveSource(source);
                        setShowEvidence(true);
                      }}
                      onQuestionSelect={(nextQuestion) => {
                        setMode("ask");
                        setQuestion(nextQuestion);
                      }}
                    />
                  ) : (
                    <EmptyState mode={mode} onRun={() => runAgentTask()} disabled={!canRun || productsLoading} />
                  )}
                </div>
              </section>
            </div>
          </div>
        </main>

        {showRightPanel && (
          <>
            <button
              aria-label="关闭依据面板"
              onClick={() => {
                setShowEvidence(false);
                setActiveSource(null);
              }}
              className="fixed inset-0 z-40 bg-slate-950/20 lg:hidden"
            />
            <EvidencePanel
              sources={allSources}
              activeSource={activeSource}
              result={result}
              onClose={() => {
                setShowEvidence(false);
                setActiveSource(null);
              }}
              onSelect={setActiveSource}
            />
          </>
        )}
      </div>
    </div>
  );
}

function TopBar({
  productsCount,
  productsLoading,
  result,
}: {
  productsCount: number;
  productsLoading: boolean;
  result: AgentResult | null;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/90 px-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg shadow-slate-900/20">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-950">PolicyGraph Agent</h2>
          <p className="text-xs text-slate-500">保险条款分析助理</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 sm:flex">
          <Database className="h-3.5 w-3.5" />
          {productsLoading ? "加载中" : `${productsCount} 个产品`}
        </span>
        {result && (
          <span className="hidden items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700 sm:flex">
            <CheckCircle2 className="h-3.5 w-3.5" />
            已完成
          </span>
        )}
      </div>
    </header>
  );
}

function TaskButton({ mode, active, onClick }: { mode: TaskMode; active: boolean; onClick: () => void }) {
  const config = taskConfig[mode];
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-all ${active
          ? "border-blue-200 bg-blue-50 text-blue-800 shadow-sm"
          : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-slate-50"
        }`}
    >
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${active ? "bg-white" : "bg-slate-50"}`}>
        {config.icon}
      </span>
      <span className="font-semibold">{config.shortTitle}</span>
    </button>
  );
}

function ProductSelect({
  label,
  value,
  products,
  onChange,
}: {
  label: string;
  value: string;
  products: ProductInfo[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-500/10"
      >
        {products.map((product) => (
          <option key={product.id} value={product.name}>
            {product.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProductSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-11 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-11 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
    </div>
  );
}

function QuestionBox({
  value,
  onChange,
  historyCount,
}: {
  value: string;
  onChange: (value: string) => void;
  historyCount: number;
}) {
  const samples = ["既往症赔不赔？", "外购药有什么限制？", "续保会被拒吗？"];

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-blue-800">想深入问什么</span>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
          maxLength={300}
          placeholder="例如：既往症赔不赔？外购药能报销吗？"
          className="w-full resize-none rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-500/10"
        />
      </label>
      {historyCount > 0 && (
        <p className="mt-1 text-[11px] leading-4 text-blue-700">
          已保留本产品 {historyCount} 轮追问，可直接继续问“那高血压呢？”
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {samples.map((sample) => (
          <button
            key={sample}
            type="button"
            onClick={() => onChange(sample)}
            className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-blue-700 shadow-sm transition-colors hover:bg-blue-100"
          >
            {sample}
          </button>
        ))}
      </div>
    </div>
  );
}

function CompareProfile({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="rounded-xl border border-violet-100 bg-violet-50 p-3">
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-violet-800">我的情况（可选）</span>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="例如：32岁，有社保，预算有限，更关心住院报销"
          className="w-full resize-none rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none transition focus:border-violet-300 focus:ring-4 focus:ring-violet-500/10"
        />
      </label>
    </div>
  );
}

function AuditChecklist() {
  const items = ["等待期", "免责条款", "续保条件", "既往症", "年龄限制", "赔付限制"];
  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
      <p className="mb-2 text-xs font-semibold text-amber-800">默认检查</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-amber-700 shadow-sm">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function CompareDimensions() {
  const items = ["产品定位", "核心保障", "等待期", "免责条款", "适合人群", "主要风险"];
  return (
    <div className="rounded-xl border border-violet-100 bg-violet-50 p-3">
      <p className="mb-2 text-xs font-semibold text-violet-800">默认维度</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-violet-700 shadow-sm">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function LoadingState({ mode, phaseIdx, elapsedMs }: { mode: TaskMode; phaseIdx: number; elapsedMs: number }) {
  const config = taskConfig[mode];
  const phases = config.phases;
  const totalEstimated = phases.reduce((sum, p) => sum + p.estimatedMs, 0);
  const cappedElapsed = Math.min(elapsedMs, totalEstimated);
  const overallPct = Math.min(100, Math.round((cappedElapsed / totalEstimated) * 100));
  const elapsedSec = (elapsedMs / 1000).toFixed(1);
  const etaMs = Math.max(0, totalEstimated - cappedElapsed);
  const etaSec = Math.ceil(etaMs / 1000);
  const overrun = elapsedMs > totalEstimated;

  let runningStart = 0;
  return (
    <div className="flex h-full min-h-[480px] items-center justify-center">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${accentBg(config.accent)}`}>
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-900">{config.title}进行中</p>
            <p className="text-xs text-slate-500">
              已用时 {elapsedSec}s・{overrun ? "超出预估，仍在生成中…" : `预计还需 ${etaSec}s`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-slate-800 tabular-nums">{overallPct}%</p>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">overall</p>
          </div>
        </div>
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-200"
            style={{ width: `${overallPct}%` }}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {phases.map((phase, index) => {
            const phaseStart = runningStart;
            const phaseEnd = phaseStart + phase.estimatedMs;
            runningStart = phaseEnd;
            const isDone = index < phaseIdx;
            const isActive = index === phaseIdx;
            const phaseProgress = isActive
              ? Math.min(100, Math.max(5, Math.round(((cappedElapsed - phaseStart) / phase.estimatedMs) * 100)))
              : isDone
                ? 100
                : 0;
            return (
              <div
                key={phase.label}
                className={`rounded-xl border p-3 transition-colors ${isDone
                    ? "border-emerald-200 bg-emerald-50/60"
                    : isActive
                      ? "border-blue-300 bg-white shadow-sm"
                      : "border-slate-200 bg-white"
                  }`}
              >
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${isDone
                        ? "bg-emerald-500 text-white"
                        : isActive
                          ? "bg-blue-500 text-white"
                          : "bg-slate-100 text-slate-500"
                      }`}
                  >
                    {isDone ? <CheckCircle2 className="h-3 w-3" /> : index + 1}
                  </span>
                  <span className={isActive ? "text-slate-900" : isDone ? "text-emerald-700" : ""}>{phase.label}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${isDone ? "bg-emerald-500" : isActive ? "bg-blue-500" : "bg-slate-200"
                      }`}
                    style={{ width: `${phaseProgress}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ mode, onRun, disabled }: { mode: TaskMode; onRun: () => void; disabled: boolean }) {
  const config = taskConfig[mode];
  return (
    <div className="flex h-full min-h-[480px] items-center justify-center">
      <div className="max-w-md text-center">
        <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${accentBg(config.accent)}`}>
          {config.icon}
        </div>
        <h3 className="text-lg font-bold text-slate-900">{config.title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {mode === "ask"
            ? "输入一个具体问题，助理会先查相关条款，再基于原文回答。"
            : mode === "compare"
              ? "选择两个产品后生成对比表，并检查双方证据是否完整。"
              : mode === "audit"
                ? "检查等待期、免责、续保等关键风险，并指出缺失信息。"
                : "生成面向普通用户的产品解读，并展示原文依据。"}
        </p>
        <button
          onClick={onRun}
          disabled={disabled}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {mode === "ask" ? <Send className="h-4 w-4" /> : config.icon}
          {config.action}
        </button>
      </div>
    </div>
  );
}

function ResultView({
  result,
  onSourceClick,
  onQuestionSelect,
}: {
  result: AgentResult;
  onSourceClick: (source: AgentSource) => void;
  onQuestionSelect: (question: string) => void;
}) {
  return (
    <div className="space-y-4">
      {result.mode === "ask" && <AskResultView result={result} onQuestionSelect={onQuestionSelect} />}
      {result.mode === "explain" && <ExplainResultView result={result} />}
      {result.mode === "compare" && <CompareResultView result={result} />}
      {result.mode === "audit" && <AuditResultView result={result} />}
      <RetrievalPlanBlock probes={result.retrievalPlan} stats={result.retrievalStats} />
      <SourceChips sources={result.sources} onSourceClick={onSourceClick} />
      <AgentSteps steps={result.agentSteps} />
    </div>
  );
}

function AskResultView({
  result,
  onQuestionSelect,
}: {
  result: AskResult;
  onQuestionSelect: (question: string) => void;
}) {
  return (
    <div className="space-y-4">
      <DecisionCard
        title="一句话结论"
        body={result.shortAnswer || result.answer}
        actions={result.nextActions}
      />
      <ResultHeader
        icon={<MessageCircleQuestion className="h-5 w-5" />}
        title={result.question}
        subtitle={result.answer}
        tone="blue"
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <InfoBlock title="对应产品" body={result.productName} />
        <ListBlock
          title="回答要点"
          items={result.keyPoints.map((item) => item.value || "条款未说明")}
          emptyText="暂无更多要点"
        />
        <ListBlock
          title="需要注意"
          items={result.caveats.map((item) => item.value || "条款未说明")}
          warning
          emptyText="暂未发现额外限制"
        />
        <FollowUpBlock questions={result.followUps} onSelect={onQuestionSelect} />
      </div>
    </div>
  );
}

function ExplainResultView({ result }: { result: ExplainResult }) {
  return (
    <div className="space-y-4">
      <ResultHeader
        icon={<ShieldCheck className="h-5 w-5" />}
        title={result.productName}
        subtitle={result.summary}
        tone="blue"
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <InfoBlock title="适合人群" body={result.suitableFor} />
        <ListBlock title="核心保障" items={result.coverages.map((item) => `${item.title || "保障"}：${item.value || "条款未说明"}`)} />
        <ListBlock title="不保什么" items={result.exclusions.map((item) => item.value || "条款未说明")} />
        <ListBlock title="需要注意" items={result.warnings.map((item) => item.value || "条款未说明")} warning />
      </div>
    </div>
  );
}

function CompareResultView({ result }: { result: CompareResult }) {
  return (
    <div className="space-y-4">
      <DecisionCard
        title="选择建议"
        body={result.recommendation || "已生成产品对比"}
        actions={result.nextActions || []}
        tone="violet"
      />
      <ResultHeader
        icon={<BarChart3 className="h-5 w-5" />}
        title={result.products.join(" vs ")}
        subtitle={result.recommendation || "已生成产品对比"}
        tone="violet"
      />
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50">
              <th className="w-28 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-500">维度</th>
              {result.products.map((product) => (
                <th key={product} className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700">
                  {product}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.table.map((row, index) => (
              <tr key={row.dimension} className={index % 2 ? "bg-slate-50/50" : "bg-white"}>
                <td className="border-b border-slate-100 px-3 py-3 align-top text-xs font-semibold text-slate-600">{row.dimension}</td>
                {result.products.map((product) => (
                  <td key={product} className="border-b border-slate-100 px-3 py-3 align-top text-slate-700">
                    {row.values[product]?.text || "条款未说明"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ListBlock title="主要结论" items={result.summary} emptyText="暂无补充结论" />
        <CoverageBlock coverage={result.evidenceCoverage} warnings={result.warnings} />
      </div>
    </div>
  );
}

function AuditResultView({ result }: { result: AuditResult }) {
  const risk = {
    low: { label: "低风险", className: "bg-emerald-50 text-emerald-700 border-emerald-100" },
    medium: { label: "中风险", className: "bg-amber-50 text-amber-700 border-amber-100" },
    high: { label: "高风险", className: "bg-red-50 text-red-700 border-red-100" },
  }[result.riskLevel];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                <FileSearch className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-950">{result.productName}</h3>
                <p className="text-sm text-slate-500">风险审计报告</p>
              </div>
            </div>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${risk.className}`}>
            <AlertTriangle className="h-3.5 w-3.5" />
            {risk.label}
          </span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {result.findings.map((finding) => (
          <div key={finding.item} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-slate-900">{finding.item}</h4>
              <StatusPill status={finding.status} />
            </div>
            <p className="text-sm leading-6 text-slate-600">{finding.conclusion}</p>
          </div>
        ))}
      </div>

      {result.suggestedQuestions.length > 0 && (
        <ListBlock title="建议追问" items={result.suggestedQuestions} warning />
      )}
    </div>
  );
}

function ResultHeader({
  icon,
  title,
  subtitle,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tone: "blue" | "violet";
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone === "blue" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700"}`}>
          {icon}
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-950">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function DecisionCard({
  title,
  body,
  actions,
  tone = "blue",
}: {
  title: string;
  body: string;
  actions?: string[];
  tone?: "blue" | "violet" | "amber";
}) {
  const classes = tone === "violet"
    ? "border-violet-100 bg-violet-50 text-violet-900"
    : tone === "amber"
      ? "border-amber-100 bg-amber-50 text-amber-900"
      : "border-blue-100 bg-blue-50 text-blue-900";
  const iconClass = tone === "violet" ? "text-violet-700" : tone === "amber" ? "text-amber-700" : "text-blue-700";

  return (
    <div className={`rounded-2xl border p-4 ${classes}`}>
      <div className="mb-2 flex items-center gap-2">
        <CheckCircle2 className={`h-4 w-4 ${iconClass}`} />
        <h3 className="text-sm font-bold">{title}</h3>
      </div>
      <p className="text-sm leading-6">{body || "条款未说明"}</p>
      {actions && actions.length > 0 && (
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {actions.slice(0, 3).map((action, index) => (
            <div key={`${action}-${index}`} className="rounded-xl bg-white/80 px-3 py-2 text-xs leading-5 shadow-sm">
              {action}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InfoBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <h4 className="mb-2 text-sm font-bold text-slate-900">{title}</h4>
      <p className="text-sm leading-6 text-slate-600">{body || "条款未说明"}</p>
    </div>
  );
}

function ListBlock({
  title,
  items,
  warning = false,
  emptyText = "条款未说明",
}: {
  title: string;
  items: string[];
  warning?: boolean;
  emptyText?: string;
}) {
  const cleaned = items.filter(Boolean);
  return (
    <div className={`rounded-xl border p-3 ${warning ? "border-amber-100 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
      <h4 className={`mb-2 text-sm font-bold ${warning ? "text-amber-900" : "text-slate-900"}`}>{title}</h4>
      {cleaned.length > 0 ? (
        <ul className="space-y-1.5">
          {cleaned.map((item, index) => (
            <li key={`${item}-${index}`} className="flex gap-2 text-sm leading-6 text-slate-600">
              <CheckCircle2 className={`mt-1 h-3.5 w-3.5 shrink-0 ${warning ? "text-amber-500" : "text-blue-500"}`} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">{emptyText}</p>
      )}
    </div>
  );
}

function FollowUpBlock({
  questions,
  onSelect,
}: {
  questions: string[];
  onSelect: (question: string) => void;
}) {
  const cleaned = questions.filter(Boolean);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <h4 className="mb-2 text-sm font-bold text-slate-900">可以继续问</h4>
      {cleaned.length > 0 ? (
        <div className="space-y-1.5">
          {cleaned.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => onSelect(question)}
              className="flex w-full items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm leading-5 text-slate-700 shadow-sm transition-colors hover:bg-blue-50 hover:text-blue-800"
            >
              <span>{question}</span>
              <Send className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">暂无建议追问</p>
      )}
    </div>
  );
}

function CoverageBlock({ coverage, warnings }: { coverage: Record<string, number>; warnings: string[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <h4 className="mb-2 text-sm font-bold text-slate-900">证据完整度</h4>
      <div className="space-y-2">
        {Object.entries(coverage).map(([name, value]) => (
          <div key={name}>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>{name}</span>
              <span>{Math.round(value * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.round(value * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      {warnings.length > 0 && (
        <div className="mt-3 space-y-1 text-xs text-amber-700">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: "found" | "missing" | "risk" }) {
  const config = {
    found: { label: "已找到", className: "bg-emerald-50 text-emerald-700 border-emerald-100" },
    missing: { label: "缺失", className: "bg-amber-50 text-amber-700 border-amber-100" },
    risk: { label: "风险", className: "bg-red-50 text-red-700 border-red-100" },
  }[status];

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${config.className}`}>
      {config.label}
    </span>
  );
}

function RetrievalPlanBlock({ probes, stats }: { probes?: RetrievalProbe[]; stats?: RetrievalStats }) {
  if (!probes?.length || !stats) return null;

  const visibleProbes = probes.slice(0, 8);
  const coverageText = stats.coverage >= 1 ? "已覆盖" : `${Math.round(stats.coverage * 100)}%`;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <FileSearch className="h-4 w-4 text-blue-600" />
            依据查找过程
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            已查看 {stats.candidateClauses} 条条款，重点引用 {stats.selectedClauses} 条来生成结论。
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-slate-50 px-2 py-1.5">
            <p className="font-bold text-slate-900">{stats.probeCount}</p>
            <p className="text-slate-500">查找方向</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5">
            <p className="font-bold text-slate-900">{stats.selectedClauses}/{stats.candidateClauses}</p>
            <p className="text-slate-500">重点依据</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5">
            <p className="font-bold text-slate-900">{coverageText}</p>
            <p className="text-slate-500">相关性</p>
          </div>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {visibleProbes.map((probe) => (
          <div key={`${probe.label}-${probe.query}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="truncate text-sm font-bold text-slate-900">{probe.label}</h4>
              <RetrievalPill coverage={probe.coverage} />
            </div>
            <p className="line-clamp-2 text-xs leading-5 text-slate-500">{probe.query}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {probe.matchedClauseIds.length > 0 ? (
                probe.matchedClauseIds.map((id) => (
                  <span key={id} className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-blue-700 shadow-sm">
                    #{id}
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-amber-700">未找到直接依据</span>
              )}
            </div>
          </div>
        ))}
      </div>
      {probes.length > visibleProbes.length && (
        <p className="mt-2 text-xs text-slate-400">另有 {probes.length - visibleProbes.length} 个检索问题已参与证据筛选</p>
      )}
    </div>
  );
}

function RetrievalPill({ coverage }: { coverage: RetrievalProbe["coverage"] }) {
  const config = {
    hit: { label: "命中", className: "bg-emerald-50 text-emerald-700 border-emerald-100" },
    partial: { label: "部分", className: "bg-blue-50 text-blue-700 border-blue-100" },
    missing: { label: "缺口", className: "bg-amber-50 text-amber-700 border-amber-100" },
  }[coverage];

  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${config.className}`}>
      {config.label}
    </span>
  );
}

function SourceChips({ sources, onSourceClick }: { sources: AgentSource[]; onSourceClick: (source: AgentSource) => void }) {
  if (!sources.length) return null;

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-bold text-blue-900">
        <FileText className="h-4 w-4" />
        原文依据
      </div>
      <div className="flex flex-wrap gap-2">
        {sources.map((source) => (
          <button
            key={source.clauseId}
            onClick={() => onSourceClick(source)}
            className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-blue-700 shadow-sm transition-colors hover:bg-blue-100"
          >
            <FileText className="h-3.5 w-3.5" />
            #{source.clauseId}
            <span className="text-blue-500">{source.productName}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AgentSteps({ steps }: { steps: AgentStep[] }) {
  if (!steps.length) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
        <Activity className="h-4 w-4 text-blue-600" />
        助理已完成
      </div>
      <div className="grid gap-2 md:grid-cols-5">
        {steps.map((step, index) => (
          <div key={`${step.label}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-2">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              {step.status === "done" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              )}
              {step.label}
            </div>
            <p className="line-clamp-2 text-[11px] leading-4 text-slate-500">{step.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EvidencePanel({
  sources,
  activeSource,
  result,
  onClose,
  onSelect,
}: {
  sources: AgentSource[];
  activeSource: AgentSource | null;
  result: AgentResult | null;
  onClose: () => void;
  onSelect: (source: AgentSource) => void;
}) {
  const selected = activeSource || sources[0] || null;

  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] shrink-0 flex-col overflow-hidden border border-slate-200/80 bg-white/95 shadow-xl shadow-slate-200/60 backdrop-blur lg:static lg:w-[420px] lg:rounded-2xl">
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-bold text-slate-900">查看依据</span>
        </div>
        <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-slate-100">
          <X className="h-4 w-4 text-slate-400" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {selected ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {sources.map((source) => (
                <button
                  key={source.clauseId}
                  onClick={() => onSelect(source)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${selected.clauseId === source.clauseId
                      ? "bg-blue-600 text-white"
                      : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                    }`}
                >
                  #{source.clauseId}
                </button>
              ))}
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Clause #{selected.clauseId}</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{selected.productName}</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                  {Math.round(selected.score * 100)}%
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{selected.snippet || "暂无原文片段"}</p>
            </div>
            {result && <AgentSteps steps={result.agentSteps} />}
          </div>
        ) : (
          <p className="mt-8 text-center text-sm text-slate-400">暂无可展示的依据</p>
        )}
      </div>
    </aside>
  );
}

function accentBg(accent: string) {
  if (accent === "violet") return "bg-violet-50 text-violet-700";
  if (accent === "amber") return "bg-amber-50 text-amber-700";
  return "bg-blue-50 text-blue-700";
}
