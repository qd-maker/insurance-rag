# Insurance RAG Engine 🏥

> 保险产品信息结构化提取系统 —— 将条款查阅时间从 10-30 分钟缩短到 10-30 秒

[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-pgvector-green)](https://supabase.com/)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o-blue)](https://openai.com/)

---

## 🎯 30 秒了解项目

**不是问答系统**，是**信息提取系统**。

| 传统方式 | 本系统 |
|----------|--------|
| 销售员翻阅 PDF 条款 | 下拉选择产品 |
| 10-30 分钟 | 10-30 秒 |
| 信息零散不完整 | 结构化卡片 + 销售话术 |
| 无法验证来源 | 每字段标注条款 ID，可点击原文 |

**核心设计决策**：用 UI 下拉框约束输入，消除拒答场景，聚焦信息质量。

---

## 🏗️ 技术架构

```
用户选择产品 → 缓存检查 → 混合检索 → LLM 结构化抽取 → 返回卡片
                  ↓              ↓
              命中秒返回    精确匹配 + 语义检索
```

| 层级 | 技术 |
|------|------|
| 全栈框架 | Next.js 16 (App Router) |
| 数据库 | Supabase (PostgreSQL + pgvector) |
| AI | OpenAI text-embedding-3-small + gpt-4o-mini |
| 样式 | Tailwind CSS + 星座粒子背景 |

---

## 🚀 快速开始

```bash
# 1. 安装
git clone https://github.com/qd-maker/insurance-rag.git && cd insurance-rag && npm install

# 2. 配置 .env.local
OPENAI_API_KEY=sk-xxx
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx
ADMIN_TOKEN=your_admin_token

# 3. 导入数据 + 启动
npx tsx scripts/seed.ts
npm run dev
```

访问 http://localhost:3000

---

## 📊 质量指标

| 指标 | 目标 | 说明 |
|------|------|------|
| 引用覆盖率 | ≥90% | 每字段标注来源，防幻觉 |
| P95 延迟 | ≤3000ms（缓存命中）| 缓存命中秒返回；首次查询经 LLM 抽取后自动缓存，后续请求均享极低延迟 |
| 错误率 | ≤5% | 系统稳定 |
| 缓存命中 | 24h TTL | 产品更新自动失效 |

```bash
# 运行评估
npm run eval
npm run baseline
```

---

## 🔌 核心 API

### POST /api/search
```json
{ "query": "安心无忧医疗险" }
```
→ 返回结构化 JSON（产品概述、核心保障、除外责任、销售话术）+ 每字段 sourceClauseId

### GET /api/products/list
→ 返回可用产品列表（供前端下拉框）

### POST /api/admin/cache (需 Token)
→ 缓存管理：查看统计、按产品清除

### GET /api/health
→ 系统健康检查（DB、OpenAI、缓存状态）

---

## 📁 项目结构

```
src/
├── app/api/         # API 路由
│   ├── search/      # 核心检索
│   ├── products/    # 产品管理
│   ├── admin/       # 管理后台
│   └── health/      # 健康检查
├── lib/
│   ├── retrieval.ts # 混合检索模块
│   ├── logger.ts    # 结构化日志
│   └── schemas.ts   # Zod Schema
scripts/
├── eval-quality.ts  # 质量评估
├── analyze-logs.ts  # 日志分析
└── seed.ts          # 数据导入
docs/
├── CACHE_STRATEGY.md
├── INTERVIEW_GUIDE.md
└── TESTING.md
```

---

## ✨ 项目亮点

| 亮点 | 体现 |
|------|------|
| **可追溯** | 每字段 sourceClauseId，点击看原文 |
| **混合检索** | 精确匹配 + 语义检索，防跨产品污染 |
| **UI 约束** | 下拉选择消除拒答场景 |
| **生产级** | 缓存、Rate Limit、结构化日志、CI 评估 |
| **复利沉淀** | experience/ 记录错误模式与设计决策 |

---

## 📄 License

MIT
