# ⚡ RAG 系统快速启动卡

**5 分钟快速启动指南**

---

## 🎯 前置条件

- ✅ Node.js 18+
- ✅ Supabase 账户（免费）
- ✅ OpenAI API 密钥

---

## 🚀 一键启动（5 步）

### Step 1: 获取密钥（2 分钟）

**Supabase 密钥：**
```
https://supabase.com → 你的项目 → Settings → API
复制：
- Project URL → SUPABASE_URL
- anon public → NEXT_PUBLIC_SUPABASE_ANON_KEY
- service_role secret → SUPABASE_SERVICE_ROLE_KEY
```

**OpenAI 密钥：**
```
https://platform.openai.com → API keys → Create new secret key
复制：OPENAI_API_KEY
```

### Step 2: 配置环境（1 分钟）

在项目根目录创建 `.env.local`：

```bash
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
```

### Step 3: 初始化数据库（1 分钟）

```
1. 打开 Supabase 控制台
2. 进入 SQL Editor
3. 新建 Query
4. 复制 supabase/sql/001_rag_schema.sql 全部内容
5. 点击 Run
```

### Step 4: 启动应用（1 分钟）

```bash
npm install
npm run dev
```

### Step 5: 验证系统（1 分钟）

```bash
# 新开一个终端
npx tsx scripts/diag.ts

# 预期输出：✅ ✨ 端到端 RAG 链路正常！
```

---

## 📊 验证清单

| 步骤 | 命令 | 预期结果 |
|------|------|--------|
| 环境 | `cat .env.local \| grep OPENAI` | 显示 API 密钥 |
| 数据库 | 访问 http://localhost:3000/api/health | status: "ok" |
| 诊断 | `npx tsx scripts/diag.ts` | ✅ 链路正常 |
| 插入数据 | `npx tsx scripts/seed.ts` | 全部完成 ✅ |
| 前端 | 打开 http://localhost:3000 | 页面加载 |

---

## 🔍 快速测试

### 在浏览器中测试

```javascript
// 打开浏览器控制台，运行：
fetch('/api/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: '尊享一生医疗险', debug: true })
})
.then(r => r.json())
.then(d => console.log(JSON.stringify(d, null, 2)));
```

### 在前端 UI 中测试

1. 打开 http://localhost:3000
2. 输入：`尊享一生医疗险`
3. 点击"查询"
4. 等待结果显示

---

## ⚠️ 常见问题速查

| 问题 | 解决方案 |
|------|--------|
| `缺少 SUPABASE_SERVICE_ROLE_KEY` | 检查 .env.local，确保有该行 |
| `match_clauses RPC 失败` | 在 Supabase SQL Editor 中执行 001_rag_schema.sql |
| `维度不匹配` | 确保 EMBEDDING_DIM=1536 |
| `检索返回空结果` | 运行 `npx tsx scripts/seed.ts` 插入数据 |
| `OpenAI API 错误` | 检查 OPENAI_API_KEY 是否有效 |

---

## 📁 关键文件位置

```
.env.local                              ← 环境变量（创建）
supabase/sql/001_rag_schema.sql         ← 数据库初始化（在 Supabase 执行）
scripts/diag.ts                         ← 诊断脚本
scripts/seed.ts                         ← 数据插入脚本
src/app/api/search/route.ts             ← RAG 查询 API
src/app/api/health/route.ts             ← 健康检查端点
src/app/page.tsx                        ← 前端 UI
RAG_SETUP_GUIDE.md                      ← 完整设置指南
```

---

## 🔗 有用的命令

```bash
# 启动开发服务器
npm run dev

# 运行诊断脚本
npx tsx scripts/diag.ts

# 插入示例数据
npx tsx scripts/seed.ts

# 检查健康状态
curl http://localhost:3000/api/health

# 查看环境变量
cat .env.local

# 构建生产版本
npm run build
```

---

## 📞 需要帮助？

1. ✅ 运行诊断脚本：`npx tsx scripts/diag.ts`
2. ✅ 查看健康检查：`curl http://localhost:3000/api/health`
3. ✅ 查看浏览器控制台错误
4. ✅ 参考 [RAG_SETUP_GUIDE.md](./RAG_SETUP_GUIDE.md)

---

**祝你使用愉快！**

