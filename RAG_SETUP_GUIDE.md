# 🚀 RAG 系统完整设置指南

本指南将帮助你从零开始搭建一个完整的 RAG（检索增强生成）系统。

---

## 📋 快速开始（5 分钟）

### 前置要求
- Node.js 18+
- Supabase 账户（免费）
- OpenAI API 密钥

### 一键初始化

```bash
# 1. 进入项目目录
cd E:\code\cursor\insurance-rag

# 2. 安装依赖
npm install

# 3. 创建 .env.local 文件
# 复制以下内容，填入你的密钥
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=sk-your-key
EMBEDDING_MODEL=text-embedding-3-small
GENERATION_MODEL=gpt-4o-mini
EMBEDDING_DIM=1536
RAG_MATCH_COUNT=10
RAG_MATCH_THRESHOLD=0.3

# 4. 在 Supabase SQL Editor 中执行 supabase/sql/001_rag_schema.sql

# 5. 运行诊断脚本
npx tsx scripts/diag.ts

# 6. 插入示例数据
npx tsx scripts/seed.ts

# 7. 启动开发服务器
npm run dev

# 8. 打开浏览器访问 http://localhost:3000
```

---

## 🔐 环境配置详细步骤

### 步骤 1：获取 Supabase 密钥

1. 登录 [Supabase](https://supabase.com)
2. 创建或进入你的项目
3. 点击 **Settings** → **API**
4. 复制以下密钥：
   - `Project URL` → `SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role secret` → `SUPABASE_SERVICE_ROLE_KEY`

### 步骤 2：获取 OpenAI 密钥

1. 登录 [OpenAI Platform](https://platform.openai.com)
2. 点击 **API keys** → **Create new secret key**
3. 复制密钥 → `OPENAI_API_KEY`

### 步骤 3：创建 `.env.local` 文件

在项目根目录创建 `.env.local`：

```bash
# Supabase 配置
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# OpenAI 配置
OPENAI_API_KEY=sk-your-key-here
EMBEDDING_MODEL=text-embedding-3-small
GENERATION_MODEL=gpt-4o-mini
EMBEDDING_DIM=1536

# 检索参数
RAG_MATCH_COUNT=10
RAG_MATCH_THRESHOLD=0.3
```

---

## 🗄️ 数据库初始化

### 在 Supabase 中执行 SQL

1. 登录 Supabase 控制台
2. 进入你的项目 → **SQL Editor**
3. 创建新的 Query
4. 复制 `supabase/sql/001_rag_schema.sql` 的全部内容
5. 粘贴到编辑器中
6. 点击 **Run** 执行

**预期输出：** 无错误，所有表、索引、函数、RLS 策略创建成功

---

## 📥 数据插入

### 使用 Seed 脚本（推荐）

```bash
npx tsx scripts/seed.ts
```

**预期输出：**
```
共 3 个产品待写入...

[1/3] 插入产品：尊享一生医疗险
产品已插入，id=1，准备写入 7 条条款...
  [1/7] 条款已写入
  ...
产品 尊享一生医疗险 数据写入完成。

全部完成 ✅
```

---

## 🔍 诊断与验证

### 运行完整诊断脚本

```bash
npx tsx scripts/diag.ts
```

**预期输出：**
```
╔════════════════════════════════════════╗
║   RAG 端到端诊断脚本 v1.0            ║
╚════════════════════════════════════════╝

━━━ Step 1: 环境变量检查 ━━━
✅ SUPABASE_URL = https://your-project.supabase.co
✅ SUPABASE_SERVICE_ROLE_KEY = your-service-role-key-...
✅ NEXT_PUBLIC_SUPABASE_ANON_KEY = your-anon-key-...
✅ OPENAI_API_KEY = sk-your-key-...

... (更多检查项)

━━━ 诊断完成 ━━━
✅ ✨ 端到端 RAG 链路正常！
```

### 健康检查

```bash
npm run dev
# 在另一个终端
curl http://localhost:3000/api/health | jq .
```

---

## 🏃 本地运行

### 启动开发服务器

```bash
npm run dev
```

### 访问应用

1. 打开浏览器：http://localhost:3000
2. 在搜索框输入产品名称，例如：
   - "尊享一生医疗险"
   - "平安福"
   - "金满意足"
3. 点击"查询"按钮
4. 等待 AI 分析结果

---

## 🛠️ 故障排查

### 问题 1：`缺少 SUPABASE_SERVICE_ROLE_KEY`

**症状：** API 返回 500 错误

**解决方案：**
```bash
# 检查 .env.local
cat .env.local | grep SUPABASE_SERVICE_ROLE_KEY

# 确保该行存在且不为空
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

### 问题 2：`match_clauses RPC 失败`

**症状：** 诊断脚本报错 "RPC 函数不存在"

**解决方案：**
1. 登录 Supabase 控制台
2. 进入 **SQL Editor**
3. 执行 `supabase/sql/001_rag_schema.sql` 中的全部 SQL

### 问题 3：`维度不匹配`

**症状：** 诊断脚本警告 "维度不匹配"

**解决方案：**
```bash
# 调整 .env.local
EMBEDDING_DIM=1536
EMBEDDING_MODEL=text-embedding-3-small
```

### 问题 4：`检索返回空结果`

**症状：** 查询成功但没有返回任何条款

**解决方案：**
```bash
# 降低相似度阈值
RAG_MATCH_THRESHOLD=0.1

# 增加检索数量
RAG_MATCH_COUNT=20
```

### 问题 5：`OpenAI API 错误`

**症状：** 诊断脚本报错 "嵌入生成失败"

**解决方案：**
1. 验证 API 密钥是否有效
2. 检查账户余额是否充足
3. 测试网络连接

---

## 📊 验收标准

- ✅ 诊断脚本返回 "✅ 端到端 RAG 链路正常"
- ✅ 健康检查返回 status = "ok"
- ✅ 前端能正常查询并显示结果
- ✅ 调试面板显示正确的诊断信息
- ✅ 没有密钥泄漏到浏览器

---

**祝你使用愉快！**

