"use client";

import React, { useEffect, useRef, useState } from 'react';
import {
  Search,
  Shield,
  AlertCircle,
  Users,
  FileText,
  ChevronDown,
  ChevronUp,
  Sparkles,
  BookOpen,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Home,
} from 'lucide-react';

// 结果类型定义（与后端 /api/search 返回保持一致）
type SearchResult = {
  productName: string;
  overview: string;
  coreCoverage: { title: string; value: string; desc: string }[];
  exclusions: string[];
  targetAudience: string;
  salesScript: string[];
  rawTerms: string;
};

const SectionTitle = ({ icon: Icon, title, className = '' }: any) => (
  <div className={`flex items-center gap-2 mb-4 text-slate-800 font-semibold ${className}`}>
    <Icon className="w-5 h-5 text-indigo-600" />
    <h3>{title}</h3>
  </div>
);

const Card = ({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) => (
  <div className={`bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-shadow duration-300 ${className}`}>
    {children}
  </div>
);

const Badge = ({ text }: { text: string }) => (
  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 mr-2">
    {text}
  </span>
);

export default function App() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [notImported, setNotImported] = useState(false);
  const [checkMeta, setCheckMeta] = useState<{ suggestions?: string[] } | null>(null);
  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (!query.trim()) { setNotImported(false); setCheckMeta(null); return; }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/check?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        const json = await res.json();
        if (json?.ok) {
          const block = json.productExists === true && json.clauseExists === false;
          setNotImported(block);
          setCheckMeta({ suggestions: json.suggestions ?? [] });
        } else {
          setNotImported(false);
          setCheckMeta(null);
        }
      } catch (err) {
        // ignore
      }
    }, 500);
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [query]);
  const [searchNotFound, setSearchNotFound] = useState<{ query: string; reason: string } | null>(null);

  const canUseActions = !!result && !loading && !notImported && !searchNotFound;

  function formatSalesScriptText(r: SearchResult): string {
    const lines: string[] = [];
    lines.push(`【产品】${r.productName}`);
    if (r.overview?.trim()) lines.push(`概览：${r.overview.trim()}`);
    if (Array.isArray(r.salesScript)) {
      r.salesScript.forEach((s, i) => {
        if (!s) return;
        lines.push(`${i + 1}) ${String(s).trim()}`);
      });
    }
    return lines.join('\n');
  }

  async function onCopyScripts() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(formatSalesScriptText(result));
      setCopyStatus('success');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (e) {
      console.warn('复制失败', e);
      setCopyStatus('error');
      setTimeout(() => setCopyStatus('idle'), 2000);
    }
  }

  async function onExportPdf() {
    if (!result) return;
    const prev = document.title;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const suggested = `${result.productName}-${y}${m}${d}`;
    try {
      document.title = suggested;
    } catch {}
    try {
      window.print();
    } finally {
      setTimeout(() => { try { document.title = prev; } catch {} }, 500);
    }
  }

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim() || loading) return;

    // 仅当“产品存在但无条款”才拦截；其余情况放行 /api/search
    if (notImported) {
      setHasSearched(true);
      setResult(null);
      setSearchNotFound(null);
      setIsTermsOpen(false);
      return;
    }

    setLoading(true);
    setHasSearched(true);
    setResult(null);
    setSearchNotFound(null);
    setIsTermsOpen(false);

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ query, matchThreshold: 0.55 }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `请求失败，状态码 ${res.status}`);
      }

      const data: any = await res.json();
      if (data?.notFound) {
        setSearchNotFound(data.notFound);
        setResult(null);
      } else {
        setResult(data as SearchResult);
        setSearchNotFound(null);
      }
    } catch (error) {
      console.error('Search failed', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-600 selection:bg-indigo-100 selection:text-indigo-900 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-10 no-print">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-1.5 rounded-lg">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-slate-900 tracking-tight text-lg">
              Insure<span className="text-indigo-600">AI</span> 智库
            </span>
          </div>
          <div className="no-print">
            {hasSearched ? (
              <button
                onClick={() => {
                  // 重置到首页视图
                  setQuery('');
                  setResult(null);
                  setNotImported(false);
                  setSearchNotFound(null);
                  setIsTermsOpen(false);
                  setHasSearched(false);
                  setCheckMeta(null);
                  setCopyStatus('idle');
                  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                className="text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded-full inline-flex items-center gap-1"
              >
                <Home className="w-3.5 h-3.5" /> 回到首页
              </button>
            ) : (
          <div className="text-xs font-medium text-slate-400 bg-slate-100 px-3 py-1 rounded-full">内部系统 v2.0</div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className={`flex-grow w-full max-w-5xl mx-auto px-4 flex flex-col gap-8 ${hasSearched ? 'py-12' : 'pt-16'}`}>
        {/* Search Section */}
        <div className={`no-print transition-all duration-500 ease-out flex flex-col items-center w-full ${hasSearched ? '' : ''}`}>
          <div className="text-center mb-6 w-full max-w-2xl mx-auto">
            {!hasSearched && (
              <>
                <h1 className="text-3xl font-bold text-slate-900 mb-1.5">想要查询什么保险产品？</h1>
                <p className="text-slate-500">输入产品名称，AI 将为您解析核心条款与销售要点</p>
              </>
            )}
          </div>

          <form onSubmit={handleSearch} className="w-full max-w-2xl mx-auto relative group">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              <Search className={`w-5 h-5 transition-colors ${loading ? 'text-indigo-500 animate-pulse' : 'text-slate-400 group-focus-within:text-indigo-500'}`} />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例如：尊享一生、平安福、金满意足..."
              className="w-full pl-12 pr-24 py-4 bg-white border border-slate-200 rounded-2xl shadow-sm text-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all hover:border-slate-300"
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => handleSearch()}
              disabled={loading || !query}
              className="absolute right-2 top-2 bottom-2 bg-slate-900 hover:bg-indigo-600 text-white px-5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? '分析中...' : '查询'}
              {!loading && <ArrowRight className="w-3.5 h-3.5" />}
            </button>
          </form>
        </div>

        {/* Loading State Skeleton */}
        {loading && (
          <div className="animate-pulse space-y-4 max-w-5xl w-full mx-auto mt-8">
            <div className="h-8 bg-slate-200 rounded w-1/3 mb-6"></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="h-40 bg-slate-200 rounded-xl"></div>
              <div className="h-40 bg-slate-200 rounded-xl md:col-span-2"></div>
            </div>
            <div className="h-60 bg-slate-200 rounded-xl"></div>
          </div>
        )}

        {/* Not Imported Hint Section */}
        {!loading && notImported && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <Card className="md:col-span-3 border-amber-200 bg-amber-50">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5" />
                <div>
                  <div className="font-semibold text-slate-800">此类保险未导入</div>
                  {checkMeta?.suggestions?.length ? (
                    <div className="mt-2 text-sm text-slate-600 flex flex-wrap items-center gap-2">
                      <span className="opacity-70">你可以试试：</span>
                      {checkMeta.suggestions.map((s) => (
                        <button
                          key={s}
                          className="px-2 py-0.5 border rounded-md hover:bg-white"
                          onClick={() => setQuery(s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Results Section */}
        {!loading && !notImported && result && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header Result */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200/60">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                  {result.productName}
                  <span className="px-2 py-1 bg-green-50 text-green-700 text-xs rounded-md font-medium border border-green-100">在售</span>
                </h2>
                <p className="text-sm text-slate-400 mt-1 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  AI 已完成核心要素提取
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onExportPdf}
                  disabled={!canUseActions}
                  className="no-print px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  导出 PDF
                </button>
                <button
                  type="button"
                  onClick={onCopyScripts}
                  disabled={!canUseActions}
                  className={`no-print px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${copyStatus==='success' ? 'bg-green-50 border-green-100 text-green-700' : 'bg-indigo-50 border-indigo-100 text-indigo-700 hover:bg-indigo-100'} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {copyStatus === 'success' ? '已复制 ✓' : copyStatus === 'error' ? '复制失败' : '复制话术'}
                </button>
              </div>
            </div>

            {/* Layout Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Product Overview (Full Width on Mobile, 2 cols on Desktop) */}
              <Card className="md:col-span-2 border-l-4 border-l-indigo-500">
                <SectionTitle icon={BookOpen} title="产品概况" />
                <p className="text-slate-700 leading-relaxed text-base">{result.overview}</p>
                <div className="mt-4 flex gap-2">
                  <Badge text="百万医疗" />
                  <Badge text="0免赔" />
                  <Badge text="特需医疗" />
                </div>
              </Card>

              {/* Target Audience */}
              <Card className="bg-gradient-to-br from-white to-slate-50">
                <SectionTitle icon={Users} title="适合人群" />
                <div className="text-slate-700 font-medium">{result.targetAudience}</div>
              </Card>

              {/* Core Coverage */}
              <Card className="md:col-span-2">
                <SectionTitle icon={Shield} title="核心保障权益" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
                  {result.coreCoverage.map((item, idx) => (
                    <div key={idx} className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                      <div className="text-indigo-600 font-bold text-xl mb-1">{item.value}</div>
                      <div className="text-slate-900 font-semibold text-sm mb-1">{item.title}</div>
                      <div className="text-xs text-slate-500 leading-snug">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Exclusions (Warning Style) */}
              <Card className="border-red-100 bg-red-50/30">
                <SectionTitle icon={XCircle} title="责任免除 (重点关注)" className="text-red-700" />
                <ul className="space-y-3">
                  {result.exclusions.map((item, idx) => (
                    <li key={idx} className="flex gap-2 text-sm text-slate-700 items-start">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              {/* Sales Script (Highlighted) */}
              <Card className="md:col-span-3 bg-indigo-50/50 border-indigo-100">
                <SectionTitle icon={Sparkles} title="AI 推荐销售话术" className="text-indigo-800" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {result.salesScript.map((script, idx) => (
                    <div key={idx} className="relative bg-white p-4 rounded-lg border border-indigo-100 shadow-sm">
                      <div className="absolute -top-2 -left-2 bg-indigo-100 text-indigo-600 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold">
                        {idx + 1}
                      </div>
                      <p className="text-slate-700 text-sm leading-relaxed">"{script}"</p>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Collapsible Raw Terms */}
              <div className="md:col-span-3">
                <button
                  onClick={() => setIsTermsOpen(!isTermsOpen)}
                  className="w-full flex items-center justify-between bg-white px-6 py-4 rounded-xl border border-slate-200 shadow-sm hover:bg-slate-50 transition-all text-left group"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                    <span className="font-medium text-slate-700">查看条款原文摘要</span>
                  </div>
                  {isTermsOpen ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                </button>

                {isTermsOpen && (
                  <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl p-6 text-sm font-mono text-slate-600 leading-relaxed whitespace-pre-wrap shadow-inner">
                    {result.rawTerms}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-8 mt-auto">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <p className="text-slate-400 text-sm">© 2025 公司内部保险查询系统 · 数据仅供参考，以正式条款为准</p>
        </div>
      </footer>
    </div>
  );
}
