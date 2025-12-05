# Insurance RAG（保险智能检索与生成系统）

一个面向保险条款与产品的 RAG（Retrieval-Augmented Generation）系统。用户输入保险产品名称，系统从数据库中检索关联条款，构建高质量上下文并调用大模型生成结构化结果：产品概况、核心保障、免责要点、适合人群、销售话术与条款原文摘要，最终以信息卡片形式在前端展示。

- 前端：Next.js 16（App Router，Turbopack），Tailwind 风格样式
- 后端：Next.js Route Handlers（Edge/Node 运行于 Vercel 或自托管）
- 数据层：Supabase（Postgres + pgvector），RPC 函数 `match_clauses`
- 模型：OpenAI Embeddings（`text-embedding-3-small`/1536维）+ 生成模型（默认 `gpt-4o-mini`）

---

## 核心价值
- 检索增强：将检索到的真实条款作为上下文，降低大模型“幻觉”风险
- 结构化输出：固定 JSON 模板，便于前端稳定渲染与二次加工
- 工程可运维：提供端到端诊断脚本，快速定位环境/维度/权限等问题

## 功能清单
- 自然语言检索条款：按产品名或关键词匹配相关条款片段
- 结构化生成结果：产品概况、核心保障、免责要点、适合人群、销售话术、条款原文摘要
- 健康检查：`GET /api/health`
- 诊断工具：`scripts/diag.ts` 一键检查环境变量、数据库、向量维度、RPC、生成能力

## 即将支持（Roadmap）
- 未导入险种提示：当输入的险种在库中不存在（或无条款）时，在搜索框下方、结果区域显示“此类保险未导入”（实时、替换结果）
- 导出 PDF、复制话术按钮完善
- 数据导入管道与重嵌入工具
- 维度对齐与一致性检查自动化

---

## 系统架构
- 前端交互（`src/app/page.tsx`）
  - 表单输入（产品名称）
  - 加载骨架屏、卡片化结果、原文摘要折叠
- 服务端路由
  - `POST /api/search`：检索 + 生成主流程
  - `GET /api/health`：健康检查
- 数据库（Supabase）
  - 表：`products`（保险产品）、`clauses`（条款片段，含向量列）
  - RPC：`match_clauses`（向量匹配，按阈值和数量返回相似条款）
- 模型调用
  - 生成查询向量 → 向量检索 → 组装上下文 → 调用生成模型（JSON 输出）

## 数据流与检索/生成流程
1. 前端提交 `query`
2. 服务器调用 OpenAI Embeddings 生成向量（1536 维）
3. 调用 Supabase RPC `match_clauses(query_embedding, match_threshold, match_count)`
4. 若无结果，回退：按产品名 `ilike` 模糊匹配 `products`，再取其条款
5. 组装上下文（长度裁剪），调用生成模型，严格按 JSON 模式输出
6. 前端接收结构化结果并渲染

---

## 快速开始

### 环境要求
- Node.js 18+
- Supabase 项目（启用 `pgvector` 扩展）
- OpenAI API Key 或兼容的聚合服务

### 安装依赖
```bash
npm install
```

### 环境变量（`.env.local`）
```env
SUPABASE_URL=你的Supabase项目URL
SUPABASE_SERVICE_ROLE_KEY=服务端密钥（仅服务端使用）
NEXT_PUBLIC_SUPABASE_ANON_KEY=匿名密钥（可选）
OPENAI_API_KEY=OpenAI或代理API Key
OPENAI_BASE_URL=可选，自建/聚合网关地址
EMBEDDING_MODEL=text-embedding-3-small
GENERATION_MODEL=gpt-4o-mini
```

### 本地启动
```bash
npm run dev
# 本地访问：http://localhost:3000
```

---

## 数据库与向量注意事项
- 表结构与 RPC 初始化脚本见：`supabase/sql/001_rag_schema.sql`
- 向量列维度必须与 `EMBEDDING_MODEL` 一致（示例为 1536）。若维度不一致：
  - `scripts/diag.ts` 会提示“配置: 1536, 实际: X”
  - 建议统一维度并重算嵌入，或迁移向量列维度

## 诊断脚本（强烈建议先运行）
```bash
npx tsx scripts/diag.ts
```
- 检查点：环境变量、Supabase 连接、表存在性、嵌入维度、RPC 调用、生成模型、RLS 等
- 脚本会插入/检索测试数据并自动清理

---

## API 文档

### 健康检查
- `GET /api/health`
- 响应：`{ ok: true }`

### 检索与生成
- `POST /api/search`
- 请求体
```json
{
  "query": "平安福",
  "matchCount": 10,           // 可选，默认 10
  "matchThreshold": 0.3,     // 可选，默认 0.3
  "debug": false             // 可选，开启后返回调试信息
}
```
- 响应体（核心结构）
```ts
{
  productName: string,
  overview: string,
  coreCoverage: Array<{ title: string; value: string; desc: string }>,
  exclusions: string[],
  targetAudience: string,
  salesScript: string[],
  rawTerms: string,
  // 当 debug=true 时，可能包含：
  // _debugUsedFallback: boolean
  // _debugContext: string
  // _debugMatches: any[]
}
```
- 示例
```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"平安福","matchThreshold":0.35}'
```

---

## 前端页面（`src/app/page.tsx`）
- 主要状态：`query`、`loading`、`result`、`isTermsOpen`、`hasSearched`
- UI 卡片：产品概况、适合人群、核心保障、免责要点、AI 推荐销售话术、条款原文摘要（可折叠）
- 交互：加载骨架屏，导出 PDF / 复制话术按钮（后续完善）

## 目录结构
```
insurance-rag/
├─ src/app
│  ├─ api/health/route.ts
│  ├─ api/search/route.ts
│  ├─ page.tsx
│  ├─ layout.tsx
│  └─ globals.css
├─ src/lib/supabaseClient.ts
├─ scripts/diag.ts
├─ scripts/seed.ts
├─ scripts/seedData.ts
├─ supabase/sql/001_rag_schema.sql
├─ next.config.ts
├─ package.json
└─ tsconfig.json
```

## 开发与安全建议
- 服务端使用 `SERVICE_ROLE_KEY`；Route Handlers 不会在浏览器端暴露密钥
- 开启并验证 RLS 策略（诊断脚本已覆盖基础读权限检查）
- 对生成模型结果做字段兜底（当前已对非 JSON 情况进行修正）
- 生产环境建议关闭 `debug` 返回

## 路线图（优先级）
- 高：未导入险种实时提示（输入框下方，替换结果区域）
- 中：PDF 导出、复制话术功能完善
- 中：数据导入管道/重嵌入工具与维度健康检查
- 低：相似险种推荐、查询日志与埋点

---

> 免责声明：本系统用于内部信息检索与销售辅助，所有内容以保险公司正式条款为准。© 2025 公司内部保险查询系统