"use client";

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import ConstellationBackground from '../components/ConstellationBackground';
import {
  Search,
  Shield,
  AlertCircle,
  Users,
  FileText,
  ChevronDown,
  Sparkles,
  BookOpen,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Link,
  History,
  Zap
} from 'lucide-react';

// ==================== 自定义类型 ====================

type Product = {
  id: number;
  name: string;
  aliases: string[];
  version: string;
  last_updated: string;
  source: string;
  is_active?: boolean;  // 产品启用状态
};

type SourceInfo = { clauseId: number; productName: string | null };

// 带引用的字段类型
type CitedField = { value: string; sourceClauseId: number | null };

// 条款映射表
type ClauseMap = Record<number, { snippet: string; productName: string | null }>;

// ==================== Fallback 处理 ====================

const FALLBACK_MARKER = '[条款未说明]';
const FALLBACK_DISPLAY = '条款中未明确说明，请以核保或公司规则为准';

// 检测值是否为 fallback
function isFallback(value: string | undefined | null): boolean {
  if (!value) return true;
  return value === FALLBACK_MARKER || value.includes(FALLBACK_MARKER);
}

// 渲染带有 fallback 处理的文本
function renderWithFallback(
  value: string | undefined | null,
  fallbackText: string = FALLBACK_DISPLAY,
  className?: string
): React.ReactNode {
  if (isFallback(value)) {
    return (
      <span className={`italic text-amber-600 ${className || ''}`}>
        ⚠️ {fallbackText}
      </span>
    );
  }
  return value;
}

type SearchResult = {
  productName: CitedField;
  overview: CitedField;
  coreCoverage: { title: string; value: string; desc: string; sourceClauseId: number | null }[];
  exclusions: { value: string; sourceClauseId: number | null }[];
  targetAudience: CitedField;
  salesScript: string[];
  rawTerms: string;
  sources: SourceInfo[];
  clauseMap: ClauseMap;
};

// ==================== 加载步骤组件 ====================

function LoadingStep({ icon, text, done, active }: {
  icon: string;
  text: string;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 py-2 px-3 rounded-xl transition-all ${active ? 'bg-blue-100 text-blue-700' : done ? 'text-green-600' : 'text-slate-400'
      }`}>
      <span className={`text-lg ${active ? 'animate-pulse' : ''}`}>{icon}</span>
      <span className={`text-sm ${done ? 'font-medium' : ''}`}>{text}</span>
      {active && <div className="ml-auto w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />}
    </div>
  );
}

// ==================== 引用徽章组件 ====================

function CitationBadge({
  clauseId,
  clauseMap,
  dark = false
}: {
  clauseId: number;
  clauseMap: ClauseMap;
  dark?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const clause = clauseMap?.[clauseId];

  if (!clause) return null;

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setIsOpen(true); }}
        className={`inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full text-xs font-medium transition-all hover:scale-105 ${dark
          ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
          }`}
        title="点击查看条款原文"
      >
        <FileText className="w-3 h-3" />
        #{clauseId}
      </button>

      {/* 条款原文弹窗 - 使用 Portal 避免 HTML 嵌套错误 */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          onClick={() => setIsOpen(false)}
        >
          {/* 背景遮罩 - 更柔和的渐变 */}
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900/60 via-slate-800/50 to-slate-900/60 backdrop-blur-md" />

          {/* 弹窗内容 */}
          <div
            className="relative bg-white/95 backdrop-blur-xl rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.3)] max-w-2xl w-full max-h-[80vh] overflow-hidden animate-scale-in border border-white/20"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 顶部装饰条 */}
            <div className="h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500" />

            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-slate-900">条款来源 #{clauseId}</h3>
                  {clause.productName && (
                    <span className="text-sm text-slate-500">{clause.productName}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-all group"
              >
                <XCircle className="w-5 h-5 text-slate-400 group-hover:text-red-500" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh] bg-slate-50/50">
              <div className="text-slate-700 leading-relaxed whitespace-pre-wrap text-sm">
                {clause.snippet}
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-white flex justify-end">
              <button
                onClick={() => setIsOpen(false)}
                className="px-6 py-2 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-all"
              >
                关闭
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ==================== 主应用 ====================

export default function App() {
  // 状态：产品列表
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  // 状态：选择与搜索
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);

  // 状态：搜索执行
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searchNotFound, setSearchNotFound] = useState<{ query: string; reason: string } | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // 状态：UI 交互
  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // 引用
  const productInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // 隐藏入口：连续点击 Logo 5 次
  const router = useRouter();
  const [logoClickCount, setLogoClickCount] = useState(0);
  const logoClickTimer = useRef<NodeJS.Timeout | null>(null);

  // 挂载时加载产品
  useEffect(() => {
    async function loadProducts() {
      try {
        const res = await fetch('/api/products/list');
        const data = await res.json();
        if (Array.isArray(data)) {
          setProducts(data);
        }
      } catch (e) {
        console.error('无法加载产品列表', e);
      } finally {
        setLoadingProducts(false);
      }
    }
    loadProducts();
  }, []);

  // 点击外部关闭下拉框
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProductDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 过滤建议产品（排除禁用产品）
  const filteredProducts = products.filter(p => {
    // 排除禁用的产品
    if (p.is_active === false) return false;

    const searchLower = productSearch.toLowerCase().trim();
    if (!searchLower) return true;
    return (
      p.name.toLowerCase().includes(searchLower) ||
      p.aliases.some(alias => alias.toLowerCase().includes(searchLower))
    );
  });

  // 操作
  const handleSelectProduct = (p: Product) => {
    setSelectedProduct(p);
    setProductSearch(p.name);
    setIsProductDropdownOpen(false);
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedProduct || loading) return;

    setLoading(true);
    setHasSearched(true);
    setResult(null);
    setSearchNotFound(null);
    setIsTermsOpen(false);

    try {
      const fullQuery = selectedProduct.name;

      const res = await fetch('/api/search', {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ query: fullQuery, matchThreshold: 0.55 }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `请求失败，状态码 ${res.status}`);
      }

      const data: any = await res.json();
      if (data?.notFound) {
        setSearchNotFound(data.notFound);
      } else {
        setResult(data as SearchResult);
      }

      // 延迟滚动
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);

    } catch (error) {
      console.error('搜索失败', error);
    } finally {
      setLoading(false);
    }
  };

  function formatSalesScriptText(r: SearchResult): string {
    return [
      `【产品卡片】${r.productName}`,
      `概览：${r.overview}`,
      `适用人群：${r.targetAudience}`,
      `核心保障：\n${r.coreCoverage.map(c => `- ${c.title} (${c.value}): ${c.desc}`).join('\n')}`,
      `销售话术：\n${r.salesScript.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    ].join('\n\n');
  }

  async function onExportFile() {
    if (!result) return;
    try {
      const content = formatSalesScriptText(result);
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${result.productName}_销售分析报告_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '')}.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setCopyStatus('success');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (e) {
      setCopyStatus('error');
      setTimeout(() => setCopyStatus('idle'), 2000);
    }
  }

  function handleReset() {
    setSelectedProduct(null);
    setProductSearch('');
    setResult(null);
    setSearchNotFound(null);
    setHasSearched(false);
    setIsProductDropdownOpen(false);
    setIsTermsOpen(false);
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // 隐藏入口：连续点击 Logo 5 次进入管理页
  function handleLogoClick() {
    const newCount = logoClickCount + 1;
    setLogoClickCount(newCount);

    // 清除之前的定时器
    if (logoClickTimer.current) {
      clearTimeout(logoClickTimer.current);
    }

    // 2 秒内未继续点击则重置计数
    logoClickTimer.current = setTimeout(() => {
      setLogoClickCount(0);
    }, 2000);

    // 达到 5 次，跳转到管理页面
    if (newCount >= 5) {
      setLogoClickCount(0);
      if (logoClickTimer.current) {
        clearTimeout(logoClickTimer.current);
      }
      router.push('/admin/products');
    }
  }

  return (
    <div className="min-h-screen relative selection:bg-blue-100 selection:text-blue-900 overflow-x-hidden">

      {/* 星座粒子动态背景 */}
      <ConstellationBackground />

      {/* 顶部导航 */}
      <nav className="fixed top-0 w-full z-50 px-8 py-6 flex justify-between items-center">
        <div className="text-xl font-bold flex items-center gap-2 text-slate-800 cursor-pointer" onClick={handleReset}>
          <span className="text-blue-600" onClick={(e) => { e.stopPropagation(); handleLogoClick(); }}>智析</span>保险知识引擎
        </div>
        {result && (
          <button
            onClick={handleReset}
            className="flex items-center gap-2 bg-white/80 backdrop-blur-md border border-slate-200 text-slate-600 px-4 py-2 rounded-full text-sm font-medium hover:bg-white hover:border-slate-300 hover:text-slate-900 transition-all shadow-sm"
          >
            <Search className="w-4 h-4" />
            重新搜索
          </button>
        )}
      </nav>

      <div className="max-w-5xl mx-auto px-6 pt-40 pb-24 relative z-20 isolate">

        {/* 标题区域: 极简纯白风格 */}
        <div className="text-center mb-24 animate-fade-in-up">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-xl flex items-center justify-center">
              <Zap className="w-8 h-8 text-blue-600" />
            </div>
          </div>
          <h1 className="text-6xl md:text-7xl font-bold tracking-tight text-slate-900 mb-6 leading-[1.1]">
            智能销售<br />
            <span className="text-slate-500 font-medium">保险产品知识助手</span>
          </h1>
          <p className="text-xl text-slate-500 max-w-lg mx-auto leading-relaxed">
            基于保险条款的深度逻辑提取。
            <br />
            精准、经过验证，且严格遵循条款。
          </p>
        </div>

        {/* 交互区 */}
        <div className="space-y-8 animate-fade-in-up delay-100 max-w-2xl mx-auto">

          {/* 产品选择器 - 悬浮胶囊风格 */}
          <div ref={dropdownRef} className="relative group z-[200]">
            <div
              onClick={() => setIsProductDropdownOpen(!isProductDropdownOpen)}
              className={`w-full bg-white p-4 pl-6 rounded-full transition-all duration-300 cursor-pointer flex items-center justify-between shadow-[0_8px_30px_rgba(0,0,0,0.04)] hover:shadow-[0_15px_40px_rgba(0,0,0,0.08)] border border-slate-100
                ${isProductDropdownOpen ? 'ring-4 ring-blue-50' : ''}
              `}
            >
              <div className="flex items-center gap-4 flex-1">
                <Search className="w-5 h-5 text-slate-400" />
                <div className={`text-lg transition-colors ${selectedProduct ? 'text-slate-900 font-medium' : 'text-slate-400'}`}>
                  {selectedProduct ? selectedProduct.name : '输入产品名称或别名搜索...'}
                </div>
              </div>
              <div className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center ml-4">
                <ChevronDown className={`w-5 h-5 text-slate-600 transition-transform duration-300 ${isProductDropdownOpen ? 'rotate-180' : ''}`} />
              </div>
            </div>

            {/* 下拉列表 */}
            {isProductDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-4 bg-white backdrop-blur-xl rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] overflow-hidden animate-scale-in origin-top z-[300] border border-slate-200">
                <div className="p-4 border-b border-slate-100">
                  <input
                    ref={productInputRef}
                    type="text"
                    className="w-full bg-transparent border-none py-2 px-4 text-slate-900 text-base focus:outline-none placeholder:text-slate-400"
                    placeholder="Type to filter..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div className="max-h-64 overflow-y-auto p-2">
                  {filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectProduct(product);
                      }}
                      className="w-full text-left p-4 rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-between group/item"
                    >
                      <div>
                        <div className="text-slate-900 font-medium group-hover/item:text-blue-600 transition-colors">{product.name}</div>
                      </div>
                      {selectedProduct?.id === product.id && <CheckCircle2 className="w-5 h-5 text-blue-600" />}
                    </button>
                  ))}
                  {filteredProducts.length === 0 && (
                    <div className="p-8 text-center text-slate-400">未找到匹配产品</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 生成按钮 - Google 黑色胶囊风格 */}
          {/* 下拉菜单打开时隐藏按钮，避免层级冲突 */}
          <div className={`flex justify-center transition-all duration-500 transform ${selectedProduct && !isProductDropdownOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'}`}>
            <button
              onClick={() => handleSearch()}
              disabled={!selectedProduct || loading}
              className="bg-black text-white h-14 pl-8 pr-2 rounded-full font-medium hover:scale-105 active:scale-95 transition-all shadow-xl flex items-center gap-4 group"
            >
              <span className="tracking-wide">{loading ? '正在解析...' : '生成智能卡片'}</span>
              <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-black group-hover:rotate-45 transition-transform">
                {loading ? <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" /> : <ArrowRight className="w-5 h-5" />}
              </div>
            </button>
          </div>

        </div>

        {/* 结果展示区 - 增加上边距避免被下拉框遮挡 */}
        <div ref={resultsRef} className="mt-64 pt-16 relative">

          {loading && (
            <div className="max-w-xl mx-auto animate-fade-in-up">
              {/* 主加载卡片 */}
              <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-8 text-center">
                {/* 动态加载动画 */}
                <div className="relative w-20 h-20 mx-auto mb-6">
                  <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
                  <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
                  <div className="absolute inset-2 rounded-full border-4 border-purple-400 border-b-transparent animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
                  <div className="absolute inset-4 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-white animate-pulse" />
                  </div>
                </div>

                <h3 className="text-xl font-bold text-slate-900 mb-2">AI 正在深度分析</h3>
                <p className="text-slate-500 text-sm mb-6">正在从保险条款中提取关键信息...</p>

                {/* 进度步骤 */}
                <div className="space-y-3 text-left bg-slate-50 rounded-2xl p-4">
                  <LoadingStep icon="✓" text="产品信息已匹配" done />
                  <LoadingStep icon="✓" text="条款内容已检索" done />
                  <LoadingStep icon="⏳" text="AI 正在分析核心保障..." active />
                  <LoadingStep icon="○" text="生成销售话术" />
                  <LoadingStep icon="○" text="整合结果" />
                </div>

                <p className="text-xs text-slate-400 mt-4">首次分析约需 30-60 秒，后续将从缓存快速获取</p>
              </div>
            </div>
          )}

          {searchNotFound && (
            <div className="p-12 rounded-3xl bg-white border border-dashed border-slate-200 text-center animate-fade-in-up max-w-2xl mx-auto">
              <div className="inline-flex p-4 rounded-full bg-red-50 mb-4 text-red-500">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">未发现相关内容</h3>
              <p className="text-slate-500">{searchNotFound.query}</p>
            </div>
          )}

          {!loading && result && (
            <div className="animate-fade-in-up space-y-16">
              {/* 结果头部 */}
              <div className="text-center">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 text-blue-600 text-xs font-bold uppercase tracking-wider mb-4">
                  <CheckCircle2 className="w-4 h-4" /> Verified Analysis
                </div>
                <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-8">
                  {typeof result.productName === 'string' ? result.productName : result.productName?.value}
                  {typeof result.productName === 'object' && result.productName?.sourceClauseId && (
                    <CitationBadge clauseId={result.productName.sourceClauseId} clauseMap={result.clauseMap} />
                  )}
                </h2>
              </div>

              {/* 卡片布局 */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                {/* 概览 */}
                <div className="lg:col-span-2 glass-panel p-8 rounded-3xl transition-all hover:bg-white">
                  <div className="flex items-center gap-3 mb-6 text-blue-600">
                    <BookOpen className="w-6 h-6" />
                    <h3 className="font-bold text-lg text-slate-900">核心分析</h3>
                  </div>
                  <p className="text-slate-600 leading-relaxed text-lg">
                    {renderWithFallback(
                      typeof result.overview === 'string' ? result.overview : result.overview?.value
                    )}
                    {typeof result.overview === 'object' && result.overview?.sourceClauseId && !isFallback(result.overview?.value) && (
                      <CitationBadge clauseId={result.overview.sourceClauseId} clauseMap={result.clauseMap} />
                    )}
                  </p>
                </div>

                {/* 适合人群 (深色突显) */}
                <div className="bg-slate-900 text-white p-8 rounded-3xl shadow-xl flex flex-col justify-between group hover:-translate-y-2 transition-transform">
                  <div className="mb-8">
                    <Users className="w-8 h-8 text-slate-400 mb-4" />
                    <h3 className="text-xl font-bold">适用人群</h3>
                  </div>
                  <p className="text-slate-300 text-lg leading-relaxed font-light">
                    {renderWithFallback(
                      typeof result.targetAudience === 'string' ? result.targetAudience : result.targetAudience?.value,
                      FALLBACK_DISPLAY,
                      'text-amber-400'
                    )}
                    {typeof result.targetAudience === 'object' && result.targetAudience?.sourceClauseId && !isFallback(result.targetAudience?.value) && (
                      <CitationBadge clauseId={result.targetAudience.sourceClauseId} clauseMap={result.clauseMap} dark />
                    )}
                  </p>
                </div>

                {/* 核心保障 */}
                <div className="lg:col-span-3 bg-white border border-slate-100 p-8 rounded-3xl shadow-sm">
                  <div className="flex items-center gap-3 mb-8">
                    <Shield className="w-6 h-6 text-slate-900" />
                    <h3 className="font-bold text-xl text-slate-900">关键权益</h3>
                  </div>
                  <div className="grid md:grid-cols-3 gap-6">
                    {result.coreCoverage.map((item, idx) => (
                      <div key={idx} className="p-6 rounded-2xl bg-slate-50 hover:bg-blue-50/50 transition-colors border border-transparent hover:border-blue-100">
                        <div className="text-2xl font-bold text-slate-900 mb-2">
                          {renderWithFallback(item.value)}
                          {item.sourceClauseId && !isFallback(item.value) && (
                            <CitationBadge clauseId={item.sourceClauseId} clauseMap={result.clauseMap} />
                          )}
                        </div>
                        <div className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-3">{item.title}</div>
                        <div className="text-sm text-slate-600 leading-relaxed">{renderWithFallback(item.desc)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 话术推荐 */}
                <div className="lg:col-span-2 glass-panel p-8 rounded-3xl">
                  <div className="flex items-center gap-3 mb-6">
                    <Sparkles className="w-6 h-6 text-purple-600" />
                    <h3 className="font-bold text-lg text-slate-900">AI 销售话术</h3>
                  </div>
                  <div className="space-y-4">
                    {result.salesScript.map((script, idx) => (
                      <div key={idx} className="flex gap-4 p-4 rounded-xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                        <span className="text-slate-200 font-black text-2xl select-none">{idx + 1}</span>
                        <p className="text-slate-700 leading-relaxed">{script}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 责任免除 */}
                <div className="p-8 rounded-3xl bg-red-50/50 border border-red-100">
                  <div className="flex items-center gap-3 mb-6 text-red-600">
                    <XCircle className="w-6 h-6" />
                    <h3 className="font-bold text-lg">责任免除</h3>
                  </div>
                  <ul className="space-y-3">
                    {result.exclusions.map((item, idx) => {
                      const itemValue = typeof item === 'string' ? item : item.value;
                      return (
                        <li key={idx} className="flex gap-3 text-slate-600 text-sm">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-2 shrink-0" />
                          <span>
                            {renderWithFallback(itemValue)}
                            {typeof item === 'object' && item.sourceClauseId && !isFallback(itemValue) && (
                              <CitationBadge clauseId={item.sourceClauseId} clauseMap={result.clauseMap} />
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

              </div>

              {/* 底部功能区 */}
              <div className="flex justify-center pt-12 pb-24">
                <button
                  onClick={onExportFile}
                  className="flex items-center gap-3 bg-blue-600 text-white px-6 py-3 rounded-full hover:bg-blue-700 transition-all text-sm font-bold shadow-lg hover:shadow-xl hover:scale-105 active:scale-95"
                >
                  {copyStatus === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                  {copyStatus === 'success' ? '导出成功' : '导出分析报告 (.md)'}
                </button>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
