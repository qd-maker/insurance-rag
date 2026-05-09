# Insurance RAG Engine v2.0 🏥🧠

> **Advanced RAG Pipeline for Insurance Document Intelligence**
> 从 Demo 到产品级 —— 多阶段检索、HyDE、Reranking、全链路 Tracing、RAGAS 评估

[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-pgvector-green)](https://supabase.com/)
[![LangFuse](https://img.shields.io/badge/LangFuse-Tracing-orange)](https://langfuse.com/)
[![RAGAS](https://img.shields.io/badge/RAGAS-Evaluation-purple)](https://docs.ragas.io/)

---

## 🎯 项目定位

**不是另一个 ChatBot**，是一个**生产级 RAG Pipeline 工程实践**：

| 维度 | v1 (Demo) | v2 (Production) |
|------|-----------|-----------------|
| 检索 | 单阶段向量检索 | **HyDE + BM25/Dense Hybrid + RRF + Reranking** |
| 分段 | 简单标题切分 | **Semantic Chunking + Overlap + 自适应阈值** |
| 生成 | 同步 JSON 输出 | **SSE 流式 + Structured Output** |
| 评估 | 手动脚本 | **RAGAS 5 维指标 + A/B 对比** |
| 可观测 | console.log | **LangFuse 全链路 Tracing** |
| 路由 | 无 | **Intent-based Query Router** |
| 压缩 | 无 | **Extractive + Abstractive 上下文压缩** |
| 接入 | 硬编码 seed | **PDF Ingestion Pipeline** |

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        RAG Pipeline v2                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Query ─→ [Query Router] ─→ Intent Classification                  │
│              │                                                       │
│              ├─ product_summary → Direct Lookup (skip HyDE)         │
│              ├─ specific_question → HyDE + Hybrid + Rerank          │
│              ├─ comparison → Multi-Retrieve + Merge                  │
│              └─ general_qa → Standard Pipeline                       │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Retrieval Stage                                               │   │
│  │                                                               │   │
│  │  [HyDE] → Generate Hypothetical Doc → Fused Embedding         │   │
│  │     │                                                         │   │
│  │     ▼                                                         │   │
│  │  [Hybrid Search]                                              │   │
│  │     ├─ Dense: pgvector cosine similarity (Top-20)             │   │
│  │     ├─ Sparse: BM25-like keyword search (Top-20)             │   │
│  │     └─ Fusion: RRF (k=60) → Merged candidates               │   │
│  │     │                                                         │   │
│  │     ▼                                                         │   │
│  │  [Cross-encoder Reranker]                                     │   │
│  │     └─ Jina/Cohere Reranker → Top-5 precision results        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [Context Compressor] → Dedup + Extractive/Abstractive compress    │
│                                                                     │
│  [Generator] → Streaming SSE + Structured JSON Output              │
│                                                                     │
│  ─── Observability Layer ────────────────────────────────────────── │
│  [LangFuse Tracing] ← Every step recorded with latency & tokens   │
│  [RAGAS Evaluation] ← Faithfulness / Relevancy / Precision / Recall│
└─────────────────────────────────────────────────────────────────────┘
```

---

## ✨ 技术亮点

### 1. HyDE (Hypothetical Document Embeddings)

**问题**：短 query（如"安心无忧医疗险"）的 embedding 与长条款文档的 embedding 存在语义鸿沟。

**方案**：先让 LLM 生成一段假设文档，再用假设文档的 embedding 去检索。

```
Query: "安心无忧医疗险"
  ↓ LLM generate
HyDE: "【产品概述】安心无忧医疗险是一款综合医疗保障产品，承保年龄..."
  ↓ embed
Fused Embedding = α × query_emb + (1-α) × hyde_emb
  ↓ search
Better retrieval results (弥合语义鸿沟)
```

### 2. Hybrid Search + RRF Fusion

**问题**：纯向量检索对专业术语（如"免赔额"）不敏感；纯关键词检索不理解同义词。

**方案**：并行执行 Dense + Sparse 检索，用 RRF 融合排名。

```
score(doc) = w₁ × 1/(k + rank_dense) + w₂ × 1/(k + rank_sparse)
```

### 3. Cross-encoder Reranking

**问题**：Bi-encoder（向量检索）是粗排，有噪声。

**方案**：粗排 Top-20 → Cross-encoder 精排 → Top-5，质量大幅提升。

### 4. Semantic Chunking with Overlap

**问题**：按固定长度或简单标题切分，导致信息丢失在边界。

**方案**：基于句子 embedding 相似度变化检测语义断裂点 + overlap 滑动窗口。

### 5. RAGAS 5 维自动化评估

| 维度 | 含义 | 目标 |
|------|------|------|
| Faithfulness | 答案是否忠实于 context | ≥85% |
| Answer Relevancy | 答案是否回答了问题 | ≥90% |
| Context Precision | 检索结果中相关比例 | ≥70% |
| Context Recall | ground truth 被 context 覆盖率 | ≥75% |
| Citation Accuracy | 引用指向正确内容 | ≥90% |

### 6. Intent-based Query Routing

不同查询走不同 pipeline 深度：
- **产品摘要** → 直接按 ID 取全量（跳过 HyDE，最快）
- **具体问题** → 完整 HyDE + Hybrid + Rerank（最精确）
- **产品对比** → 多路检索 + 结果合并
- **通用问答** → 标准 pipeline

---

## 🚀 快速开始

```bash
# 克隆 & 安装
git clone https://github.com/qd-maker/insurance-rag.git
cd insurance-rag && npm install

# 配置环境变量
cp .env.example .env.local

# 导入数据 & 启动
npx tsx scripts/seed.ts
npm run dev
```

### 环境变量

```env
# Required
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx

# RAG Pipeline
GENERATION_MODEL=gpt-4o-mini
EMBEDDING_MODEL=text-embedding-3-small
RETRIEVAL_TOP_K=20
RETRIEVAL_THRESHOLD=0.3

# Reranker (optional, graceful fallback)
JINA_API_KEY=jina_xxx
# COHERE_API_KEY=xxx

# Observability (optional)
LANGFUSE_PUBLIC_KEY=pk-xxx
LANGFUSE_SECRET_KEY=sk-xxx
LANGFUSE_HOST=https://cloud.langfuse.com

# Cache
ENABLE_SEARCH_CACHE=true
```

---

## 📁 项目结构 (v2)

```
src/
├── app/
│   ├── page.tsx                    # 主页面
│   ├── admin/                      # 管理后台
│   └── api/
│       ├── v2/search/route.ts      # ⭐ V2 搜索 API (Advanced RAG)
│       ├── search/route.ts         # V1 搜索 API (兼容)
│       ├── products/               # 产品 CRUD
│       └── health/                 # 健康检查
├── components/                     # UI 组件
├── lib/
│   ├── rag/                        # ⭐ Advanced RAG Pipeline
│   │   ├── pipeline.ts             # 主编排器
│   │   ├── query-router.ts         # 查询路由
│   │   ├── hyde.ts                 # HyDE 假设文档嵌入
│   │   ├── hybrid-search.ts        # BM25 + Dense + RRF
│   │   ├── reranker.ts             # Cross-encoder Reranking
│   │   ├── context-compressor.ts   # 上下文压缩
│   │   ├── generator.ts            # 流式结构化生成
│   │   ├── chunker.ts              # 语义分段
│   │   ├── ingestion.ts            # 文档导入 Pipeline
│   │   ├── tracing.ts              # LangFuse Tracing
│   │   ├── evaluation.ts           # RAGAS 评估
│   │   ├── types.ts                # 类型定义
│   │   └── index.ts                # 统一导出
│   ├── retrieval.ts                # V1 检索（保留兼容）
│   ├── embeddings.ts               # Embedding 工具
│   └── schemas/                    # Zod Schema
scripts/
├── eval-ragas.ts                   # ⭐ RAGAS 评估
├── eval-compare.ts                 # ⭐ A/B Pipeline 对比
├── seed.ts                         # 数据导入
└── ...
```

---

## 🧪 评估 & 对比

```bash
# 运行 RAGAS 评估（指定配置）
npm run eval:ragas -- --config=hyde_rerank

# A/B 对比多个配置
npm run eval:compare -- --configs=baseline,hyde_only,hybrid_only,hyde_rerank

# 原有质量评估（兼容）
npm run eval
```

### 示例对比输出

```
📊 ═══════ COMPARISON RESULTS ═══════

| Config          | Avg Latency | P95 Latency | Avg Tokens | Errors |
|-----------------|-------------|-------------|------------|--------|
| v1_baseline     |     2100ms  |     3200ms  |     1800   |    0   |
| v2_hyde         |     3500ms  |     4800ms  |     2100   |    0   |
| v2_hybrid       |     2800ms  |     3900ms  |     1900   |    0   |
| v2_full         |     4200ms  |     5500ms  |     2200   |    0   |

(质量指标：v2_full 的 Faithfulness 提升 15%, Context Precision 提升 22%)
```

---

## 🛠️ 可用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建 |
| `npm run eval:ragas` | RAGAS 5 维评估 |
| `npm run eval:compare` | Pipeline A/B 对比 |
| `npm run ingest` | 文档导入 Pipeline |
| `npm run test` | 单元测试 (Vitest) |
| `npm run test:e2e` | E2E 测试 (Playwright) |

---

## 📄 License

MIT
