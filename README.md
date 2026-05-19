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

# 配置环境变量（参考下方"环境变量"清单）
cp .env.example .env.local
# 如需 Docker 本地启动，也可以复制为 .env.production
# cp .env.example .env.production

# 导入种子数据
npx tsx scripts/seed.ts

# 启动开发服务器
npm run dev
# 访问 http://localhost:3000

# 健康检查（验证 6 个依赖：env / supabase / openai / database / rag / cache）
curl http://localhost:3000/api/health
```

### 环境变量

```env
# === Required: OpenAI 兼容 ===
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://yunwu.ai/v1         # 也可替换为其他 OpenAI 兼容代理或官方地址

# === Required: Supabase (pgvector) ===
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx

# === RAG Pipeline ===
# 注意：gpt-5-nano 是 reasoning model，单次 30-90s；gpt-4o-mini 在本项目实测快 4 倍
GENERATION_MODEL=gpt-4o-mini
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIM=1536                          # 必须与 EMBEDDING_MODEL 真实维度一致

# 前端公共变量（页面直连 Supabase 时需要）
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
EMBEDDING_TIMEOUT_MS=15000                  # embedding 单次超时
EMBEDDING_MAX_RETRIES=1                     # 指数退避重试次数
EMBEDDING_STRICT_DIM=false                  # true 表示维度不符直接抛错

RETRIEVAL_TOP_K=20
RETRIEVAL_THRESHOLD=0.3

# === Agent 模式专用阈值 ===
AGENT_RETRIEVAL_TOP_K=2
AGENT_RETRIEVAL_THRESHOLD=0.15

# === Reranker (可选，缺失时静默降级) ===
JINA_API_KEY=jina_xxx
# COHERE_API_KEY=xxx

# === Observability (可选) ===
LANGFUSE_PUBLIC_KEY=pk-xxx
LANGFUSE_SECRET_KEY=sk-xxx
LANGFUSE_HOST=https://cloud.langfuse.com

# === Cache ===
ENABLE_SEARCH_CACHE=true
```

> ⚠️ **关于模型选择**：项目支持任何 OpenAI 兼容 API。`gpt-5-nano` 这类推理模型质量更高但单次 30-90s；
> `gpt-4o-mini` 在本项目 compare 模式实测 ~17s，速度/成本/质量平衡最佳。

---

## 🎮 产品交互层 — 4 模式 Agent

面向 non-tech 用户的统一对话入口（`/chat`）：选产品 → 选模式 → 出结构化结果。

| 模式 | 用途 | 输入 | 输出 |
|------|------|------|------|
| **提问 (ask)** | 围绕单产品的具体问题 | 产品 + 自然语言问题 | 短答案 + 关键要点 + 注意事项 + 追问建议 |
| **解读 (explain)** | 全面解读单产品 | 产品 | 概述 + 适合人群 + 保障责任 + 免责条款 + 警告 |
| **对比 (compare)** | 两个产品的 6 维对比 | 产品 A + 产品 B + 用户情况 | 6×2 对比表 + 推荐 + 警告 + 下一步行动 |
| **审计 (audit)** | 风险审计 + 缺失项 | 产品 | 风险等级 + 关键发现 + 缺失项清单 |

每个模式都内置：

- AbortController 防竞态（切模式时自动取消旧请求）
- 60s 前端超时 + 渐进式真实进度条
- 每条结论强制绑定 `sourceClauseIds` 原文条款
- 错误时返回 `traceId` 便于排查

API：`POST /api/agent/{ask,explain,compare,audit}`，参数走 zod 校验，详见 `src/app/api/agent/`。

---

## � 性能基准（实测）

环境：Next.js 16 dev mode + 单机 + 国内聚合代理 + `gpt-4o-mini`

| 模式 | 检索拓扑 | 实测耗时 | 备注 |
|------|---------|---------|------|
| ask | 1 product × N probe | ~8-12s | 单产品自由问答 |
| explain | 1 product × 6 dimensions | ~10-15s | 6 维度并行检索 |
| **compare** | **2 products × 6 dimensions** | **~16-17s** | 12 路并行检索 + 单次 LLM |
| audit | 1 product × N rules | ~10-13s | 规则引擎 + LLM 综合 |

> 拆解：`compare 16.75s = fetch(1.6s) + retrieve(6.7s) + LLM(~8s)`。详见 `progress.txt` 性能瓶颈定位记录。
> 切换到 `gpt-5-nano` 等 reasoning model 质量更高但耗时增至 ~70s（4× 慢）。

---

## � 项目结构 (v2)

```
src/
├── app/
│   ├── page.tsx                    # 落地页
│   ├── chat/page.tsx               # ⭐ 主交互页（4 模式 Agent）
│   ├── legacy/page.tsx             # V1 旧版主页
│   ├── admin/                      # 管理后台
│   └── api/
│       ├── agent/{ask,explain,compare,audit}/route.ts  # ⭐ 4 模式 Agent API
│       ├── v2/search/route.ts      # V2 搜索 API (Advanced RAG)
│       ├── search/route.ts         # V1 搜索 API (兼容)
│       ├── products/               # 产品 CRUD
│       └── health/                 # 多依赖聚合健康检查
├── components/                     # UI 组件
├── lib/
│   ├── agent/
│   │   └── product-agent.ts        # ⭐ Agent 编排（ask/explain/compare/audit）
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
│   ├── embeddings.ts               # Embedding 工具（含 timeout/retry）
│   └── schemas/                    # Zod Schema
scripts/
├── eval-quality.ts                 # 质量评估（CI 默认入口）
├── eval-ragas.ts                   # ⭐ RAGAS 5 维评估
├── eval-compare.ts                 # ⭐ A/B Pipeline 对比
├── compare-baseline.ts             # 与 baseline 比较（CI 用）
├── analyze-logs.ts                 # 日志分析
├── check-log-size.ts               # 日志体积监控
├── regenerate-vectors.ts           # 重新嵌入向量
├── seed.ts / seedData.ts           # 数据导入
├── parse_pdf.py                    # PDF 文本提取
└── *.sql                           # 建表/迁移/清理
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
| `npm run dev` | 开发服务器（webpack） |
| `npm run dev:turbo` | 开发服务器（turbopack） |
| `npm run build` | 生产构建 |
| `npm run start` | 生产启动 |
| `npm run lint` | ESLint 检查 |
| `npm run baseline` | 生成 baseline 评估快照 |
| `npm run eval` | 质量评估 |
| `npm run eval:ragas` | RAGAS 5 维评估 |
| `npm run eval:compare` | Pipeline A/B 对比 |
| `npm run analyze-logs` | 查询日志分析 |
| `npm run check-logs` | 日志文件体积监控 |
| `npx tsx scripts/seed.ts` | 数据导入（产品 + 条款 + 向量） |
| `npm run test` | 单元测试 (Vitest，待补充测试用例) |
| `npm run test:e2e` | E2E 测试 (Playwright，待补充用例) |

> 数据库 / 迁移：见 `scripts/*.sql` 与 `supabase/sql/*.sql`。

---

## 🩺 健康检查

`GET /api/health` 一次性聚合 6 个依赖检查（独立 timeout，互不阻塞）：

```jsonc
{
  "status": "ok",
  "checks": {
    "environment":  { "ok": true, "message": "所有必需的环境变量已配置" },
    "supabase":     { "ok": true, "message": "Supabase 连接正常" },
    "openai":       { "ok": true, "message": "OpenAI 连接正常 (维度: 1024)" },
    "database":     { "ok": true, "message": "数据库表与 RPC 函数正常" },
    "rag_pipeline": { "ok": true, "message": "RAG 流水线正常 (1 条条款已嵌入)" },
    "cache":        { "ok": true, "message": "缓存系统正常 (0 活跃, 19 过期)" }
  }
}
```

---

## 🤝 贡献

CI 已配置（`.github/workflows/eval.yml`）：

- 在每个 PR 自动运行 `eval-quality.ts` 评估脚本
- 与 `outputs/baseline_quality.json` 基线对比
- 超过错误率阈值（5%）或引用覆盖率低于阈值（85%）会阻塞合并

---

## 📄 License

MIT — 详见 [`LICENSE`](./LICENSE)。
