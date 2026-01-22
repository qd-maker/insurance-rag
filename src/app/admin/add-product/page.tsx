"use client";

import React, { useState } from 'react';
import {
    Shield,
    FileText,
    Send,
    CheckCircle2,
    XCircle,
    Loader2,
    Lock,
    ArrowLeft,
    AlertTriangle,
    Database,
    Cpu,
    Sparkles,
    FileCode2
} from 'lucide-react';
import Link from 'next/link';

type Step = {
    step: string;
    status: 'pending' | 'running' | 'done' | 'error';
    detail?: string;
};

type ApiResponse = {
    success: boolean;
    message: string;
    steps?: Step[];
    results?: {
        productId?: number;
        clauseId?: number;
        error?: string;
    };
};

const stepIcons: Record<string, React.ReactNode> = {
    '保存到 seedData.ts': <FileCode2 className="w-5 h-5" />,
    'AI 抽取产品描述': <Sparkles className="w-5 h-5" />,
    '写入产品数据库': <Database className="w-5 h-5" />,
    '生成向量嵌入': <Cpu className="w-5 h-5" />,
    '写入条款和向量': <Database className="w-5 h-5" />,
};

export default function AddProductPage() {
    const [token, setToken] = useState('');
    const [tokenInput, setTokenInput] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [authLoading, setAuthLoading] = useState(true);
    const [loginLoading, setLoginLoading] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [content, setContent] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [steps, setSteps] = useState<Step[]>([]);
    const [results, setResults] = useState<ApiResponse['results']>(undefined);

    // 从 sessionStorage 获取并验证 token
    React.useEffect(() => {
        const savedToken = sessionStorage.getItem('admin_token');
        if (savedToken) {
            fetch('/api/admin/verify-token', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${savedToken}` },
            })
                .then(res => res.json())
                .then(data => {
                    if (data.valid) {
                        setToken(savedToken);
                        setIsAuthenticated(true);
                    } else {
                        sessionStorage.removeItem('admin_token');
                    }
                })
                .catch(() => {
                    sessionStorage.removeItem('admin_token');
                })
                .finally(() => setAuthLoading(false));
        } else {
            setAuthLoading(false);
        }
    }, []);

    const handleLogin = async () => {
        const trimmed = tokenInput.trim();
        if (!trimmed) return;

        setLoginLoading(true);
        setLoginError(null);

        try {
            const res = await fetch('/api/admin/verify-token', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${trimmed}` },
            });
            const data = await res.json();

            if (!res.ok || !data.valid) {
                setLoginError(data.error || 'Token 验证失败');
                return;
            }

            sessionStorage.setItem('admin_token', trimmed);
            setToken(trimmed);
            setIsAuthenticated(true);
        } catch {
            setLoginError('网络请求失败，请重试');
        } finally {
            setLoginLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!token.trim()) {
            setStatus('error');
            setMessage('认证已过期，请返回产品管理页面重新验证');
            return;
        }

        if (!name.trim()) {
            setStatus('error');
            setMessage('请输入产品名称');
            return;
        }

        if (!content.trim()) {
            setStatus('error');
            setMessage('请输入产品内容');
            return;
        }

        setStatus('loading');
        setMessage('');
        setSteps([
            { step: '保存到 seedData.ts', status: 'pending' },
            { step: 'AI 抽取产品描述', status: 'pending' },
            { step: '写入产品数据库', status: 'pending' },
            { step: '生成向量嵌入', status: 'pending' },
            { step: '写入条款和向量', status: 'pending' },
        ]);
        setResults(undefined);

        // 模拟进度动画
        const progressInterval = setInterval(() => {
            setSteps(prev => {
                const pendingIndex = prev.findIndex(s => s.status === 'pending');
                if (pendingIndex === -1 || pendingIndex >= 3) {
                    clearInterval(progressInterval);
                    return prev;
                }
                return prev.map((s, i) => {
                    if (i === pendingIndex) return { ...s, status: 'running' };
                    return s;
                });
            });
        }, 800);

        try {
            const res = await fetch('/api/products/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ name: name.trim(), content: content.trim() }),
            });

            clearInterval(progressInterval);
            const data: ApiResponse = await res.json();

            if (data.steps) {
                setSteps(data.steps);
            }
            if (data.results) {
                setResults(data.results);
            }

            if (res.ok && data.success) {
                setStatus('success');
                setMessage(data.message || '产品添加成功！');
                setName('');
                setContent('');
            } else {
                setStatus('error');
                setMessage(data.message || '添加失败');
            }
        } catch (err) {
            clearInterval(progressInterval);
            setStatus('error');
            setMessage('网络错误，请稍后重试');
        }
    };

    // 加载中
    if (authLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    // 未认证 - 显示登录界面
    if (!isAuthenticated) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="bg-white p-8 rounded-2xl shadow-lg max-w-sm w-full">
                    <div className="text-center mb-6">
                        <div className="inline-flex p-3 rounded-xl bg-blue-50 mb-4">
                            <Lock className="w-8 h-8 text-blue-600" />
                        </div>
                        <h1 className="text-xl font-bold text-slate-900">添加新险种</h1>
                        <p className="text-slate-500 text-sm mt-1">请输入管理员 Token</p>
                    </div>
                    <input
                        type="password"
                        value={tokenInput}
                        onChange={(e) => setTokenInput(e.target.value)}
                        placeholder="管理员 Token"
                        className={`w-full px-4 py-3 rounded-xl border focus:ring-2 focus:outline-none mb-2 ${loginError ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : 'border-slate-200 focus:border-blue-500 focus:ring-blue-100'}`}
                        onKeyDown={(e) => e.key === 'Enter' && !loginLoading && handleLogin()}
                        disabled={loginLoading}
                    />
                    {loginError && (
                        <div className="text-red-600 text-sm mb-3 flex items-center gap-1">
                            <XCircle className="w-4 h-4" />
                            {loginError}
                        </div>
                    )}
                    <button
                        onClick={handleLogin}
                        disabled={!tokenInput.trim() || loginLoading}
                        className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 disabled:bg-slate-300 transition-colors flex items-center justify-center gap-2"
                    >
                        {loginLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                        {loginLoading ? '验证中...' : '进入'}
                    </button>
                    <div className="mt-4 text-center">
                        <Link href="/admin/products" className="text-sm text-blue-600 hover:underline">
                            返回产品管理
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* 顶部导航 */}
            <nav className="bg-white border-b border-slate-200 px-6 py-4">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                        <span className="text-sm font-medium">返回主页</span>
                    </Link>
                    <div className="text-xl font-bold flex items-center gap-2 text-slate-800">
                        <span className="text-blue-600">智析</span>保险知识引擎
                    </div>
                </div>
            </nav>

            <div className="max-w-2xl mx-auto px-6 py-12">
                {/* 页面标题 */}
                <div className="text-center mb-10">
                    <div className="inline-flex p-4 rounded-2xl bg-blue-50 mb-4">
                        <Shield className="w-10 h-10 text-blue-600" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        添加新险种
                    </h1>
                    <p className="text-slate-500">
                        填写产品信息后，系统将自动生成向量并入库
                    </p>
                </div>

                {/* 表单 */}
                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* 产品名称 */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            <FileText className="w-4 h-4 inline mr-1" />
                            产品名称
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="例如：平安福终身寿险"
                            disabled={status === 'loading'}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all text-slate-900 placeholder:text-slate-400 disabled:bg-slate-100"
                        />
                    </div>

                    {/* 产品内容 */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            产品内容 / 条款描述
                        </label>
                        <textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder="请输入产品的完整描述，包括保障内容、赔付条件、除外责任等..."
                            rows={8}
                            disabled={status === 'loading'}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all text-slate-900 placeholder:text-slate-400 resize-none disabled:bg-slate-100"
                        />
                    </div>

                    {/* 提交按钮 */}
                    <button
                        type="submit"
                        disabled={status === 'loading'}
                        className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-200"
                    >
                        {status === 'loading' ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                正在处理...
                            </>
                        ) : (
                            <>
                                <Send className="w-5 h-5" />
                                提交并生成向量
                            </>
                        )}
                    </button>
                </form>

                {/* 进度展示 */}
                {steps.length > 0 && (
                    <div className="mt-8 p-6 rounded-2xl bg-white border border-slate-200 shadow-sm">
                        <h3 className="font-bold text-slate-900 mb-4">处理进度</h3>
                        <div className="space-y-4">
                            {steps.map((step, idx) => (
                                <div key={idx} className="flex items-start gap-4">
                                    {/* 图标 */}
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${step.status === 'done' ? 'bg-green-100 text-green-600' :
                                        step.status === 'running' ? 'bg-blue-100 text-blue-600' :
                                            step.status === 'error' ? 'bg-red-100 text-red-600' :
                                                'bg-slate-100 text-slate-400'
                                        }`}>
                                        {step.status === 'done' ? (
                                            <CheckCircle2 className="w-5 h-5" />
                                        ) : step.status === 'running' ? (
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                        ) : step.status === 'error' ? (
                                            <XCircle className="w-5 h-5" />
                                        ) : (
                                            stepIcons[step.step] || <div className="w-2 h-2 rounded-full bg-slate-300" />
                                        )}
                                    </div>

                                    {/* 内容 */}
                                    <div className="flex-1 pt-2">
                                        <div className={`font-medium ${step.status === 'done' ? 'text-green-700' :
                                            step.status === 'running' ? 'text-blue-700' :
                                                step.status === 'error' ? 'text-red-700' :
                                                    'text-slate-400'
                                            }`}>
                                            {step.step}
                                        </div>
                                        {step.detail && (
                                            <div className="text-sm text-slate-500 mt-0.5">
                                                {step.detail}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* 结果摘要 */}
                        {results && (status === 'success' || status === 'error') && (
                            <div className={`mt-6 p-4 rounded-xl ${status === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                                }`}>
                                {status === 'success' ? (
                                    <div className="flex items-center gap-3 text-green-800">
                                        <CheckCircle2 className="w-6 h-6 text-green-600" />
                                        <div>
                                            <div className="font-bold">添加成功！</div>
                                            <div className="text-sm text-green-700 mt-1">
                                                产品 ID: {results.productId} | 条款 ID: {results.clauseId}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-3 text-red-800">
                                        <XCircle className="w-6 h-6 text-red-600" />
                                        <div>
                                            <div className="font-bold">添加失败</div>
                                            <div className="text-sm text-red-700 mt-1">
                                                {results.error || message}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* 简单错误消息（无步骤时） */}
                {status === 'error' && steps.length === 0 && (
                    <div className="mt-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3">
                        <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                        <div className="text-sm text-red-800">
                            <p className="font-medium mb-1">操作失败</p>
                            <p>{message}</p>
                        </div>
                    </div>
                )}

                {/* 成功后的提示 */}
                {status === 'success' && (
                    <div className="mt-6 text-center">
                        <Link
                            href="/"
                            className="inline-flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-full font-medium hover:bg-slate-800 transition-all"
                        >
                            返回主页验证新产品
                            <ArrowLeft className="w-4 h-4 rotate-180" />
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
