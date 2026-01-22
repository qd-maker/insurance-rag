"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
    Shield,
    ArrowLeft,
    Power,
    PowerOff,
    History,
    RefreshCw,
    Search,
    CheckCircle2,
    XCircle,
    Loader2,
    Clock,
    User,
    ChevronDown,
    ChevronUp,
    AlertTriangle,
    Lock
} from 'lucide-react';

type Product = {
    id: number;
    name: string;
    description: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    created_by: string | null;
};

type AuditLog = {
    id: number;
    action: string;
    operator: string;
    created_at: string;
    notes: string | null;
    before_snapshot: any;
    after_snapshot: any;
};

export default function ProductsManagementPage() {
    const [token, setToken] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedProductId, setExpandedProductId] = useState<number | null>(null);
    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
    const [loadingAudit, setLoadingAudit] = useState(false);
    const [togglingId, setTogglingId] = useState<number | null>(null);

    useEffect(() => {
        const savedToken = sessionStorage.getItem('admin_token');
        if (savedToken) {
            // 验证保存的 token 是否仍然有效
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
                });
        }
    }, []);

    const [loginLoading, setLoginLoading] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(null);

    const handleLogin = async () => {
        const trimmed = token.trim();
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
        } catch (err: any) {
            setLoginError('网络请求失败，请重试');
        } finally {
            setLoginLoading(false);
        }
    };

    // 加载产品列表
    const loadProducts = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/products/list');
            const data = await res.json();
            if (Array.isArray(data)) {
                setProducts(data);
            } else {
                throw new Error('返回数据格式错误');
            }
        } catch (err: any) {
            setError(err.message || '加载失败');
        } finally {
            setLoading(false);
        }
    };

    // 加载审计日志
    const loadAuditLogs = async (productId: number) => {
        const authToken = token.trim();
        if (!authToken) {
            setIsAuthenticated(false);
            return;
        }
        setLoadingAudit(true);
        try {
            const res = await fetch(`/api/admin/audit-log?productId=${productId}`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
            });
            const data = await res.json();
            if (data.success && data.logs) {
                setAuditLogs(data.logs);
            }
        } catch (err) {
            console.error('加载审计日志失败', err);
        } finally {
            setLoadingAudit(false);
        }
    };

    // 切换产品状态
    const toggleProductStatus = async (productId: number, currentActive: boolean) => {
        const authToken = token.trim();
        if (!authToken) {
            alert('认证已过期，请重新输入管理员 Token');
            setIsAuthenticated(false);
            return;
        }
        setTogglingId(productId);
        try {
            const res = await fetch('/api/products/toggle-status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                },
                body: JSON.stringify({ productId, active: !currentActive }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                alert(data?.error || data?.message || '操作失败');
                return;
            }
            if (data.success) {
                // 更新本地状态
                setProducts(prev => prev.map(p =>
                    p.id === productId ? { ...p, is_active: !currentActive } : p
                ));
                // 如果当前展开了这个产品，刷新审计日志
                if (expandedProductId === productId) {
                    loadAuditLogs(productId);
                }
            } else {
                alert(data?.message || data?.error || '操作失败');
            }
        } catch (err) {
            alert('操作失败，请重试');
        } finally {
            setTogglingId(null);
        }
    };

    // 展开/收起审计日志
    const toggleExpand = (productId: number) => {
        if (expandedProductId === productId) {
            setExpandedProductId(null);
            setAuditLogs([]);
        } else {
            setExpandedProductId(productId);
            loadAuditLogs(productId);
        }
    };

    // 认证后加载产品
    useEffect(() => {
        if (isAuthenticated) {
            loadProducts();
        }
    }, [isAuthenticated]);

    // 过滤产品
    const filteredProducts = products.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // 认证界面
    if (!isAuthenticated) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="bg-white p-8 rounded-2xl shadow-lg max-w-sm w-full">
                    <div className="text-center mb-6">
                        <div className="inline-flex p-3 rounded-xl bg-blue-50 mb-4">
                            <Lock className="w-8 h-8 text-blue-600" />
                        </div>
                        <h1 className="text-xl font-bold text-slate-900">产品管理</h1>
                        <p className="text-slate-500 text-sm mt-1">请输入管理员 Token</p>
                    </div>
                    <input
                        type="password"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
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
                        disabled={!token.trim() || loginLoading}
                        className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 disabled:bg-slate-300 transition-colors flex items-center justify-center gap-2"
                    >
                        {loginLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                        {loginLoading ? '验证中...' : '进入管理'}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* 顶部导航 */}
            <nav className="bg-white border-b border-slate-200 px-6 py-4">
                <div className="max-w-6xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors">
                            <ArrowLeft className="w-5 h-5" />
                            <span className="text-sm font-medium">返回主页</span>
                        </Link>
                        <span className="text-slate-300">|</span>
                        <Link href="/admin/add-product" className="text-sm font-medium text-blue-600 hover:text-blue-700">
                            + 添加产品
                        </Link>
                    </div>
                    <div className="text-xl font-bold flex items-center gap-2 text-slate-800">
                        <Shield className="w-6 h-6 text-blue-600" />
                        产品管理
                    </div>
                </div>
            </nav>

            <div className="max-w-6xl mx-auto px-6 py-8">
                {/* 搜索和刷新 */}
                <div className="flex items-center gap-4 mb-6">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="搜索产品..."
                            className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                        />
                    </div>
                    <button
                        onClick={loadProducts}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                        刷新
                    </button>
                </div>

                {/* 统计信息 */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-white p-4 rounded-xl border border-slate-100">
                        <div className="text-2xl font-bold text-slate-900">{products.length}</div>
                        <div className="text-sm text-slate-500">总产品数</div>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-100">
                        <div className="text-2xl font-bold text-green-600">{products.filter(p => p.is_active).length}</div>
                        <div className="text-sm text-slate-500">已启用</div>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-100">
                        <div className="text-2xl font-bold text-red-600">{products.filter(p => !p.is_active).length}</div>
                        <div className="text-sm text-slate-500">已禁用</div>
                    </div>
                </div>

                {/* 错误提示 */}
                {error && (
                    <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-center gap-3 text-red-800">
                        <AlertTriangle className="w-5 h-5" />
                        {error}
                    </div>
                )}

                {/* 产品列表 */}
                <div className="space-y-4">
                    {loading && products.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                            加载中...
                        </div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                            暂无产品
                        </div>
                    ) : (
                        filteredProducts.map(product => (
                            <div key={product.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                                {/* 产品行 */}
                                <div className="p-4 flex items-center gap-4">
                                    {/* 状态指示 */}
                                    <div className={`w-3 h-3 rounded-full ${product.is_active ? 'bg-green-500' : 'bg-red-500'}`} />

                                    {/* 产品信息 */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-bold text-slate-900 truncate">{product.name}</h3>
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${product.is_active
                                                ? 'bg-green-100 text-green-700'
                                                : 'bg-red-100 text-red-700'
                                                }`}>
                                                {product.is_active ? '启用' : '禁用'}
                                            </span>
                                        </div>
                                        {product.description && (
                                            <p className="text-sm text-slate-500 truncate mt-1">{product.description}</p>
                                        )}
                                    </div>

                                    {/* 操作按钮 */}
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => toggleProductStatus(product.id, product.is_active)}
                                            disabled={togglingId === product.id}
                                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${product.is_active
                                                ? 'bg-red-50 text-red-700 hover:bg-red-100'
                                                : 'bg-green-50 text-green-700 hover:bg-green-100'
                                                } disabled:opacity-50`}
                                        >
                                            {togglingId === product.id ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : product.is_active ? (
                                                <PowerOff className="w-4 h-4" />
                                            ) : (
                                                <Power className="w-4 h-4" />
                                            )}
                                            {product.is_active ? '禁用' : '启用'}
                                        </button>

                                        <button
                                            onClick={() => toggleExpand(product.id)}
                                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors"
                                        >
                                            <History className="w-4 h-4" />
                                            历史
                                            {expandedProductId === product.id ? (
                                                <ChevronUp className="w-4 h-4" />
                                            ) : (
                                                <ChevronDown className="w-4 h-4" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* 审计日志展开区 */}
                                {expandedProductId === product.id && (
                                    <div className="border-t border-slate-100 bg-slate-50 p-4">
                                        <h4 className="font-bold text-sm text-slate-700 mb-3">操作历史</h4>
                                        {loadingAudit ? (
                                            <div className="text-center py-4 text-slate-500">
                                                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                                            </div>
                                        ) : auditLogs.length === 0 ? (
                                            <div className="text-center py-4 text-slate-400 text-sm">
                                                暂无操作记录
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {auditLogs.map(log => (
                                                    <div key={log.id} className="flex items-start gap-3 p-3 bg-white rounded-lg border border-slate-100">
                                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${log.action === 'CREATE' ? 'bg-green-100 text-green-600' :
                                                            log.action === 'UPDATE' ? 'bg-blue-100 text-blue-600' :
                                                                log.action === 'DISABLE' ? 'bg-red-100 text-red-600' :
                                                                    log.action === 'ENABLE' ? 'bg-green-100 text-green-600' :
                                                                        'bg-slate-100 text-slate-600'
                                                            }`}>
                                                            {log.action === 'CREATE' && <CheckCircle2 className="w-4 h-4" />}
                                                            {log.action === 'UPDATE' && <RefreshCw className="w-4 h-4" />}
                                                            {log.action === 'DISABLE' && <PowerOff className="w-4 h-4" />}
                                                            {log.action === 'ENABLE' && <Power className="w-4 h-4" />}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 text-sm">
                                                                <span className="font-medium text-slate-900">{log.action}</span>
                                                                <span className="text-slate-400">•</span>
                                                                <span className="text-slate-500 flex items-center gap-1">
                                                                    <User className="w-3 h-3" />
                                                                    {log.operator}
                                                                </span>
                                                                <span className="text-slate-400">•</span>
                                                                <span className="text-slate-500 flex items-center gap-1">
                                                                    <Clock className="w-3 h-3" />
                                                                    {new Date(log.created_at).toLocaleString('zh-CN')}
                                                                </span>
                                                            </div>
                                                            {log.notes && (
                                                                <p className="text-xs text-slate-500 mt-1">{log.notes}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
