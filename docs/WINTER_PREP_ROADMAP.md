# 寒假 6 周 AI 应用工程实习准备计划

> **背景**：大二学生，目标 AI 应用工程 / AI 全栈工程实习  
> **项目**：保险产品信息结构化提取与销售话术生成系统  
> **核心定位**：不是问答系统，是下拉选择 → 完整信息卡片提取 → 字段级引用追溯

---

## Week 1：API 契约与 Schema 校验加固

**核心目标**：确保所有 API 端点有严格的输入/输出 Schema 校验，消除运行时类型错误

### 工程任务

1. **补全 `/api/products/list` 响应 Schema**
   - 文件：`src/lib/schemas/products.ts`
   - 新增 `ProductListResponseSchema`，包含 `id, name, aliases, is_active` 字段
   - 在 `route.ts` 中使用 `safeParse` 校验响应

2. **补全 `/api/products/add` 请求 Schema**
   - 文件：`src/lib/schemas/products.ts`
   - 新增条款内容格式校验（非空、最小长度）
   - 添加 `clauses` 数组的 `z.array().min(1)` 约束

3. **为 SearchSuccessResponse 添加运行时校验**
   - 文件：`src/app/api/search/route.ts`
   - LLM 返回后，用 `SearchSuccessResponseSchema.safeParse()` 校验
   - 校验失败时返回 `{ error: 'SCHEMA_VIOLATION', raw: ... }`

4. **创建 Schema 校验单元测试**
   - 新建：`scripts/test-schemas.ts`
   - 覆盖：正常 case + 边界 case（空数组、null 字段、超长文本）

5. **更新 README API 文档**
   - 文件：`README.md`
   - 为每个 API 添加请求/响应 JSON 示例

### 可验收产出

- [ ] `npx tsx scripts/test-schemas.ts` 全部通过
- [ ] `/api/search` 返回 Schema 不合规时，前端能显示明确错误
- [ ] README 中有完整的 API Schema 文档

---

## Week 2：RAG 检索可靠性强化

**核心目标**：提升混合检索的可测试性和稳定性，建立检索质量的量化指标

### 工程任务

1. **抽取混合检索逻辑为独立模块**
   - 新建：`src/lib/retrieval.ts`
   - 导出 `hybridRetrieve(query, options)` 函数
   - 从 `search/route.ts` 中移除内联逻辑，调用该模块

2. **新增检索调试 API**
   - 新建：`src/app/api/debug/retrieval/route.ts`
   - 返回：`{ priorityProductIds, vectorMatches, finalRows, retrievalStrategy }`
   - 仅 `debug=true` 时启用，生产默认关闭

3. **检索质量评估脚本**
   - 新建：`scripts/eval-retrieval.ts`
   - 指标：产品命中率、Top-K 召回覆盖率、跨产品污染率
   - 测试集：复用 `data/eval_set.csv` 的产品名

4. **产品隔离策略文档化**
   - 更新：`experience/rag_error_patterns.md`
   - 新增「模式 7：产品隔离策略」小节
   - 记录当前 `priorityProductIds` 过滤逻辑

5. **调整 matchCount 和 threshold 为可配置**
   - 文件：`src/lib/retrieval.ts`
   - 从环境变量读取：`RETRIEVAL_TOP_K`、`RETRIEVAL_THRESHOLD`
   - 默认值保持 `10` 和 `0.3`

### 可验收产出

- [ ] `src/lib/retrieval.ts` 文件存在，被 `search/route.ts` 调用
- [ ] `npx tsx scripts/eval-retrieval.ts` 输出产品命中率 ≥ 95%
- [ ] `/api/debug/retrieval` 可返回检索中间结果

---

## Week 3：缓存稳定性与失效机制

**核心目标**：实现缓存主动失效能力，确保条款更新后不返回过期数据

### 工程任务

1. **新增缓存管理 API**
   - 新建：`src/app/api/admin/cache/route.ts`
   - `DELETE /api/admin/cache?product=产品名` 按产品名清除缓存
   - `GET /api/admin/cache/stats` 返回缓存命中率统计

2. **产品更新时自动清缓存**
   - 文件：`src/app/api/products/toggle/route.ts`
   - 当产品状态变更时，调用 `supabase.from('search_cache').delete().eq('query_text', productName)`

3. **缓存健康检查**
   - 文件：`src/app/api/health/route.ts`
   - 新增 `cache: { enabled, hitRate24h, expiredCount }` 字段
   - 查询 `search_cache` 表统计

4. **缓存失效测试脚本**
   - 新建：`scripts/test-cache-invalidation.ts`
   - 流程：写入缓存 → 模拟产品更新 → 验证缓存已清除

5. **缓存策略文档**
   - 新建：`docs/CACHE_STRATEGY.md`
   - 内容：缓存键设计、TTL 策略、失效触发条件、运维命令

### 可验收产出

- [ ] `DELETE /api/admin/cache?product=安心无忧医疗险` 返回 `{ cleared: true }`
- [ ] 产品启用/禁用后，该产品缓存被自动清除（日志可验证）
- [ ] `docs/CACHE_STRATEGY.md` 存在

---

## Week 4：结构化日志与可观测性

**核心目标**：建立可查询的日志系统，支持问题排查和性能分析

### 工程任务

1. **日志结构升级**
   - 文件：`src/lib/logger.ts`
   - 新增字段：`request_id`（UUID）、`retrieval_strategy`、`cache_hit`
   - 输出格式保持 JSONL

2. **日志分析脚本**
   - 新建：`scripts/analyze-logs.ts`
   - 功能：统计每日请求量、P95 延迟、缓存命中率、错误率
   - 输出：终端表格 + `outputs/log_analysis_YYYYMMDD.json`

3. **错误日志专项收集**
   - 文件：`src/lib/logger.ts`
   - 新增 `logError(requestId, errorType, errorMessage, stack?)` 方法
   - 错误日志写入 `logs/error_YYYYMMDD.jsonl`

4. **请求链路追踪**
   - 文件：`src/app/api/search/route.ts`
   - 在响应头中返回 `X-Request-Id`
   - 前端在 console 中打印 request_id，便于联调

5. **日志轮转提醒**
   - 新建：`scripts/check-log-size.ts`
   - 检查 `logs/` 目录大小，超过 100MB 时输出警告

### 可验收产出

- [ ] 每条日志包含 `request_id` 字段
- [ ] `npx tsx scripts/analyze-logs.ts` 输出当日统计报告
- [ ] API 响应头包含 `X-Request-Id`

---

## Week 5：评估体系完善与 CI 集成

**核心目标**：评估脚本可自动运行，baseline 回归有 CI 保护

### 工程任务

1. **GitHub Actions 评估 Workflow**
   - 新建：`.github/workflows/eval.yml`
   - 触发：PR 到 main 分支
   - 步骤：启动 dev server → 运行 `eval-quality.ts` → 对比 baseline

2. **Baseline 版本化管理**
   - 将 `outputs/baseline_quality.json` 加入 Git 追踪
   - 新增 npm script：`"baseline": "npx tsx scripts/eval-quality.ts --baseline"`

3. **评估报告 HTML 生成**
   - 文件：`scripts/generate-html-report.ts`（已存在则完善）
   - 输出：`outputs/report_YYYYMMDD.html`
   - 包含：指标卡片、趋势折线图（如有历史数据）

4. **评估失败通知**
   - 在 GitHub Actions 中，若 `error_rate > 5%` 或 `citation_coverage < 85%`，标记为失败
   - 输出具体退化指标到 PR 评论（可选）

5. **测试集扩展**
   - 文件：`data/eval_set.csv`
   - 新增 5 条边界 case：超长产品名、含特殊符号、别名查询

### 可验收产出

- [ ] PR 触发 GitHub Actions 评估
- [ ] `npm run baseline` 可执行
- [ ] `outputs/baseline_quality.json` 在版本控制中

---

## Week 6：管理员安全加固与面试准备

**核心目标**：完成安全最小化要求，整理面试材料

### 工程任务

1. **Admin API Rate Limit**
   - 文件：`src/app/api/admin/verify-token/route.ts`
   - 实现：同一 IP 5 分钟内失败 5 次后锁定 15 分钟
   - 存储：内存 Map（MVP 阶段足够）

2. **审计日志查询 API**
   - 新建：`src/app/api/admin/audit/route.ts`
   - `GET /api/admin/audit?product_id=1&limit=50` 返回操作历史

3. **敏感操作二次确认**
   - 文件：`src/app/admin/products/page.tsx`
   - 禁用/启用产品前，弹窗确认「此操作将清除该产品缓存，确认继续？」

4. **面试 Q&A 文档**
   - 更新：`docs/INTERVIEW_GUIDE.md`
   - 新增：
     - 「为什么用 UI 约束而不是 prompt 拒答？」
     - 「缓存失效策略是什么？」
     - 「如果要支持 10 万用户，你会改什么？」

5. **项目 README 精简**
   - 文件：`README.md`
   - 重点突出：项目定位、核心设计决策、运行方式
   - 删除冗余内容，控制在 300 行以内

### 可验收产出

- [ ] 连续 5 次错误 token 后，API 返回 429
- [ ] `docs/INTERVIEW_GUIDE.md` 包含 ≥10 个 Q&A
- [ ] README 清晰展示项目亮点（适合 30 秒扫描）

---

## 总览表

| Week | 核心目标 | 关键产出 |
|------|---------|---------|
| 1 | API Schema 校验加固 | `test-schemas.ts` 通过 |
| 2 | RAG 检索可靠性 | `retrieval.ts` 模块 + 检索评估脚本 |
| 3 | 缓存失效机制 | `CACHE_STRATEGY.md` + 缓存管理 API |
| 4 | 结构化日志 | 日志分析脚本 + `X-Request-Id` |
| 5 | CI 评估集成 | GitHub Actions Workflow |
| 6 | 安全加固 + 面试准备 | Rate Limit + 面试 Q&A 文档 |

---

## 执行原则

1. **每周五自检**：对照「可验收产出」逐条确认
2. **代码先行**：先写代码，再补文档
3. **小步提交**：每个任务完成即 commit，消息格式 `feat(week1): add schema validation`
4. **问题记录**：遇到卡点，记录到 `experience/` 对应文档
