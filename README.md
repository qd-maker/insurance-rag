# Insurance RAG Engine 🏥

> **保险产品信息结构化提取系统** —— 将条款查阅时间从 10-30 分钟缩短到 10-30 秒

[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-pgvector-green)](https://supabase.com/)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o-blue)](https://openai.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

<p align="center">
  <img src="docs/screenshots/home.png" alt="首页 - 产品选择" width="80%" />
</p>

---

## 🎯 30 秒了解项目

**不是问答系统**，是**信息提取系统**。

| 传统方式 | 本系统 |
|----------|--------|
| 销售员翻阅 PDF 条款 | 下拉选择产品 |
| 10-30 分钟 | **10-30 秒** |
| 信息零散不完整 | 结构化卡片 + 销售话术 |
| 无法验证来源 | 每字段标注条款 ID，可点击原文 |

**核心设计决策**：用 UI 下拉框约束输入，消除拒答场景，聚焦信息质量。

---

## 📸 功能演示

### 渐进式加载 — 感知性能优化

首次查询经过 Embedding → 向量检索 → LLM 结构化抽取，通过渐进式步骤动画降低等待焦虑感。

<p align="center">
  <img src="docs/screenshots/loading.png" alt="渐进式加载步骤" width="60%" />
</p>

### 结构化智能卡片 — 可追溯引用

每个字段标注来源条款 ID，点击可查看原文。核心保障、责任免除、销售话术一目了然。

<p align="center">
  <img src="docs/screenshots/result.png" alt="智能卡片结果" width="80%" />
</p>

---

## 🏗️ 技术架构

```
用户选择产品 → 缓存检查 → 混合检索 → LLM 结构化抽取 → 返回卡片
                  ↓              ↓                ↓
              命中秒返回    产品名命中=全量直取   渐进式加载动画
                           未命中=语义检索兜底
```

| 层级 | 技术 | 说明 |
|------|------|------|
| 全栈框架 | Next.js 16 (App Router) | 前后端一体化，API Routes + SSR |
| 数据库 | Supabase (PostgreSQL + pgvector) | 关系数据 + 向量检索一体化 |
| AI 模型 | qwen3-embedding-4b + gpt-4o-mini | Embedding + 结构化抽取 |
| 样式 | Tailwind CSS v4 | 星座粒子背景 + 毛玻璃面板 |
| 校验 | Zod v4 | 端到端类型安全，Schema 驱动 |

---

## 🚀 快速开始

```bash
# 1. 克隆 & 安装
git clone https://github.com/qd-maker/insurance-rag.git
cd insurance-rag && npm install

# 2. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填入以下必需项：
#   OPENAI_API_KEY=sk-xxx
#   SUPABASE_URL=https://xxx.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=xxx
#   ADMIN_TOKEN=your_admin_token

# 3. 导入数据 & 启动
npx tsx scripts/seed.ts
npm run dev
```

访问 http://localhost:3000

---

## ✨ 核心亮点

### 1. UI 强约束设计

用下拉框替代自由输入，从产品层面消除拒答场景。**约束优于自由**——让技术实现更简单，信息质量更高。

### 2. 混合检索策略（Level 1 产品隔离）

```
产品名命中 → 按 product_id 全量直取所有 chunk → 完整覆盖
产品名未命中 → 语义向量检索 + 优先级重排序 → 兜底
所有策略失败 → ilike 模糊匹配 → 最终兜底
```

产品卡片场景本质是"已知产品做结构化摘要"，不是开放问答。
因此命中产品名后**跳过全库向量排序**，直接按 `product_id` 取全量条款，避免非概述 chunk 被全局排序淘汰。

### 3. 可追溯引用

每个字段标注 `sourceClauseId`，前端渲染为可点击的引用徽章。测试体系有专门的**引用覆盖率指标**（≥90%），持续监控引用质量。

### 4. 渐进式加载体验

首次查询 10-25 秒的等待通过 4 阶段渐进式动画（匹配产品 → 检索条款 → AI 分析 → 生成卡片）+ 进度条反馈，将用户感知等待时间大幅缩短。底部文案提供预期管理。

### 5. 版本化缓存

首次查询经 LLM 抽取后自动写入 Supabase 缓存（24h TTL），后续命中缓存 <100ms 返回。缓存键包含检索版本号，检索策略变更时旧缓存自动失效，保证一致性。

---

## 📊 质量指标

| 指标 | 目标 | 实测 | 说明 |
|------|------|------|------|
| 字段完整率 | ≥95% | 95.8% | 结构化抽取质量 |
| 引用覆盖率 | ≥90% | 91.7% | 每字段标注来源，防幻觉 |
| 引用有效率 | 100% | 100% | 所有引用 ID 可查原文 |
| P95 延迟 | ≤3000ms（缓存命中）| <100ms | 缓存命中秒返回 |
| 错误率 | ≤5% | <5% | 系统稳定性 |
| 稳定性得分 | 100% | 100% | 同产品多次查询结果一致 |

```bash
# 运行质量评估
npm run eval
npm run baseline
```

---

## 🔌 核心 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/search` | POST | 核心检索：传入产品名，返回结构化卡片 + 引用 |
| `/api/products/list` | GET | 产品列表（供前端下拉框） |
| `/api/products/add` | POST | 添加新产品 + 条款（需 Token） |
| `/api/products/toggle-status` | POST | 启用/禁用产品（自动清缓存） |
| `/api/admin/cache` | GET/DELETE | 缓存管理：统计 / 按产品清除 |
| `/api/health` | GET | 健康检查（DB、AI、缓存状态） |

### 请求示例

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "安心无忧医疗险", "matchThreshold": 0.55}'
```

---

## 📁 项目结构

```
src/
├── app/
│   ├── page.tsx           # 主页面（产品选择 + 智能卡片展示）
│   ├── admin/             # 管理后台（产品管理、添加产品）
│   └── api/
│       ├── search/        # 核心检索 API
│       ├── products/      # 产品 CRUD
│       ├── admin/         # 管理接口（缓存、审计、PDF解析）
│       └── health/        # 健康检查
├── components/
│   └── ConstellationBackground.tsx  # 星座粒子动态背景
├── lib/
│   ├── retrieval.ts       # 混合检索模块（产品隔离 + 向量兜底）
│   ├── chunking.ts        # 条款语义分段
│   ├── embeddings.ts      # 向量嵌入工具
│   ├── logger.ts          # 结构化日志（JSONL）
│   ├── schemas/           # Zod Schema 体系（7个模块）
│   └── supabaseClient.ts  # 数据库客户端
scripts/
├── seed.ts                # 数据导入（产品 + 条款 + 向量）
├── eval-quality.ts        # 6大指标质量评估
├── compare-baseline.ts    # 基线对比
├── analyze-logs.ts        # 日志分析
└── generate-html-report.ts # HTML 评估报告生成
docs/
├── CACHE_STRATEGY.md      # 缓存策略设计文档
├── TESTING.md             # 测试文档
└── screenshots/           # 项目截图
experience/
├── ai_product_decisions.md    # AI 产品决策规则
├── rag_error_patterns.md      # RAG 错误模式（8个模式）
└── backend_error_patterns.md  # 后端错误模式
```

---

## 🛠️ 可用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建 |
| `npm run eval` | 运行质量评估（6大指标） |
| `npm run baseline` | 生成基线评估报告 |
| `npm run analyze-logs` | 分析查询日志 |

---

## 📄 License

MIT
