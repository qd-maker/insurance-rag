# Insurance RAG Engine 🏥

> 基于 RAG（Retrieval-Augmented Generation）技术的保险产品知识助手

[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green)](https://supabase.com/)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o-blue)](https://openai.com/)

---

## 📌 项目概述

> **⚠️ 重要**: 这是一个**保险产品信息结构化提取系统**,不是问答系统

**业务场景**: 销售人员通过下拉框选择保险产品,系统从条款中提取完整的结构化信息,生成信息卡片和销售话术。

**核心功能**:
- 🎯 **信息提取**: 从保险条款中提取结构化信息(产品概述、核心保障、除外责任、适用人群)
- 📎 **可追溯**: 每个字段都标注来源条款 ID(sourceClauseId),可点击查看原文
- 💬 **销售话术**: 自动生成2-5条销售话术
- ⚡ **效率提升**: 将查阅条款时间从 10-30 分钟缩短到 10-30 秒

**关键设计**:
- ✅ 用户只选择产品(下拉框),不输入问题
- ✅ 系统提取完整信息,不是按需回答
- ✅ UI强约束消除拒答场景,聚焦信息质量

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 15 + React + Tailwind CSS |
| 后端 | Next.js API Routes (Node.js) |
| 数据库 | Supabase (PostgreSQL + pgvector) |
| AI | OpenAI API (Embedding + Chat) |

---

## 🚀 快速开始

### 1. 克隆仓库
```bash
git clone https://github.com/qd-maker/insurance-rag.git
cd insurance-rag
npm install
```

### 2. 配置环境变量
创建 `.env.local` 文件：
```bash
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1  # 或第三方代理
EMBEDDING_MODEL=text-embedding-ada-002
EMBEDDING_DIM=1536
GENERATION_MODEL=gpt-4o-mini
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
ADMIN_TOKEN=your_admin_token
```

### 3. 初始化数据库
在 Supabase SQL Editor 中执行：
- 创建 `products` 和 `clauses` 表
- 启用 pgvector 扩展

### 4. 导入示例数据
```bash
npx tsx scripts/seed.ts
```

### 5. 启动开发服务器
```bash
npm run dev
```

访问 http://localhost:3000

---

## 📊 系统架构

```
用户输入产品名
      ↓
[拒答检测] → 无意义输入直接返回错误
      ↓
[缓存检查] → 命中则秒返回
      ↓
[混合检索]
  ├── 产品名精确匹配
  └── 语义向量检索
      ↓
[LLM 生成] → 结构化 JSON + 条款引用
      ↓
[写入缓存] → 24小时有效
      ↓
[返回前端] → 渲染卡片 + 引用徽章
```

---

## ✨ 核心功能

### 智能搜索 API

**POST /api/search**

请求 Schema：
```typescript
{
  query: string,              // 必填，产品名称（1-200字符）
  matchCount?: number,        // 可选，检索数量（1-50，默认10）
  matchThreshold?: number,    // 可选，相似度阈值（0-1，默认0.1）
  debug?: boolean             // 可选，是否返回调试信息
}
```

请求示例：
```json
{ "query": "安心无忧医疗险", "matchCount": 5 }
```

成功响应 Schema：
```typescript
{
  productName: { value: string, sourceClauseId: number | null },
  overview: { value: string, sourceClauseId: number | null },
  coreCoverage: Array<{
    title: string,
    value: string,
    desc: string,
    sourceClauseId: number | null
  }>,
  exclusions: Array<{ value: string, sourceClauseId: number | null }>,
  targetAudience: { value: string, sourceClauseId: number | null },
  salesScript: string[],
  rawTerms: string,
  sources: Array<{ clauseId: number, productName: string | null }>,
  clauseMap: Record<number, { snippet: string, productName: string | null }>,
  _cached?: boolean
}
```

错误响应（Schema 校验失败）：
```json
{
  "error": "SCHEMA_VIOLATION",
  "message": "LLM 输出结构校验失败",
  "details": [...],
  "raw": { ... }
}
```

---

### 产品列表 API

**GET /api/products/list**

响应 Schema：
```typescript
Array<{
  id: number,
  name: string,
  description: string | null,
  is_active: boolean,
  created_at: string | null,
  updated_at: string | null,
  created_by: string | null,
  aliases: string[],
  version: string,
  last_updated: string,
  source: string
}>
```

响应示例：
```json
[
  {
    "id": 1,
    "name": "安心无忧医疗险",
    "description": "一款百万医疗险产品",
    "is_active": true,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-02T00:00:00Z",
    "created_by": "admin",
    "aliases": ["安心医疗", "无忧医疗"],
    "version": "1.0",
    "last_updated": "2024-01-02",
    "source": "database"
  }
]
```

---

### 添加产品 API

**POST /api/products/add**（需 Authorization: Bearer Token）

请求 Schema：
```typescript
{
  name: string,               // 必填，产品名称（1-200字符）
  content: string,            // 必填，产品条款内容
  clauses?: Array<{           // 可选，条款数组（至少1条）
    title?: string,           // 可选，条款标题（1-200字符）
    content: string           // 必填，条款内容（10-50000字符）
  }>
}
```

请求示例：
```json
{
  "name": "安心无忧医疗险",
  "content": "产品条款全文内容...",
  "clauses": [
    { "title": "保障责任", "content": "条款内容至少10个字符..." }
  ]
}
```

成功响应：
```json
{
  "success": true,
  "message": "产品 \"安心无忧医疗险\" 已成功添加！",
  "steps": [
    { "step": "保存到 seedData.ts", "status": "done" },
    { "step": "AI 抽取产品描述", "status": "done", "detail": "\"百万医疗险...\"" },
    { "step": "写入产品数据库", "status": "done", "detail": "新建产品 ID: 5" },
    { "step": "生成向量嵌入", "status": "done", "detail": "向量维度: 1536" },
    { "step": "写入条款和向量", "status": "done", "detail": "新建条款 ID: 8" }
  ],
  "results": { "productId": 5, "clauseId": 8 }
}
```

---

### 检查产品 API

**GET /api/products/check?q=产品名**

响应示例：
```json
{
  "ok": true,
  "imported": true,
  "productExists": true,
  "clauseExists": true,
  "matchedProductId": 1,
  "matchedProductName": "安心无忧医疗险",
  "suggestions": []
}
```

---

### 产品状态切换 API

**POST /api/products/toggle-status**

请求 Schema：
```typescript
{
  productId: number,          // 必填，产品ID（正整数）
  active: boolean,            // 必填，是否启用
  notes?: string              // 可选，备注（最多500字）
}
```

请求示例：
```json
{ "productId": 1, "active": false, "notes": "产品下架维护" }
```

### 拒答策略
自动拒绝以下输入：
- 长度 < 2 字符
- 纯数字
- 纯符号
- 重复字符

### 缓存系统
- 可选启用（`ENABLE_SEARCH_CACHE=true`）
- 24 小时过期
- 归一化查询文本作为缓存键

---

## 🎨 界面设计

- **星座粒子背景**：Canvas 动画，鼠标交互
- **Antigravity 风格**：大圆角、玻璃态、渐变装饰
- **引用徽章**：点击查看条款原文
- **加载动画**：5 步进度提示

---

## 📈 评估体系

| 指标 | 数值 |
|------|------|
| 测试集 | 30 条查询 |
| Baseline 准确率 | 90% |
| 测试分组 | 精确名/别名/拒答 |

---

## 📁 项目结构

```
insurance-rag/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── search/        # 核心搜索 API
│   │   │   ├── products/      # 产品管理 API
│   │   │   └── health/        # 健康检查
│   │   ├── admin/             # 后台管理页面
│   │   └── page.tsx           # 主页面
│   ├── components/            # UI 组件
│   └── lib/                   # 工具函数
├── scripts/
│   ├── seed.ts                # 数据导入
│   ├── seedData.ts            # 示例产品数据
│   └── eval.ts                # 评估脚本
├── experience/                # 复利经验文档
│   ├── rag_error_patterns.md
│   └── backend_error_patterns.md
└── data/                      # 测试数据
```

---

## 🎯 项目亮点

| 亮点 | 说明 |
|------|------|
| **RAG 可追溯** | 每个字段附带 sourceClauseId |
| **混合检索** | 精确匹配 + 语义检索 |
| **评估驱动** | 先建 baseline 再优化 |
| **复利沉淀** | experience/ 记录错误模式 |
| **生产级考量** | 缓存、拒答、日志 |

---

## 🧪 测试与质量保证

本项目通过**分层测试集**和**5大核心指标**持续监控 RAG 系统质量。

### 快速开始

```bash
# 1. 建立质量基线
npx tsx scripts/eval-quality.ts --baseline

# 2. 生成可视化HTML报告
npx tsx scripts/generate-html-report.ts outputs/baseline_quality.json

# 3. 修改代码后,对比基线
npx tsx scripts/eval-quality.ts --compare outputs/baseline_quality.json
```

### 核心指标

| 指标 | 目标值 | 证明能力 |
|------|--------|----------|
| **引用率** | ≥90% | 回答可溯源,非幻觉 |
| **P95延迟** | ≤3000ms | 性能可预测 |
| **错误率** | ≤5% | 系统稳定性 |
| **结构化输出合格率** | 100% | 输出稳定可控 |

### 测试集设计

- **Group A (10条)**: 精确输入 - 验证基础识别能力
- **Group B (10条)**: 模糊输入 - 验证鲁棒性与泛化能力
- **Group C (10条)**: 拒答场景 - 验证边界控制能力

📖 **详细文档**: [docs/TESTING.md](docs/TESTING.md)

---

## 📄 License

MIT

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
