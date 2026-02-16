# 端奇

南京｜19851602981｜1550100326@qq.com｜GitHub: https://github.com/qd-maker

**求职方向**：AI 产品经理 / AI 工程师（实习）

---

## 教育背景

**南京工业职业技术大学**｜网络工程｜本科（大二在读）  
预计毕业：2028

**相关课程**：数据库、计算机网络、网络编程技术  
**英语**：CET-6

---

## 技能概览

- **RAG / Prompt**：检索-增强-生成流程、结构化 JSON 输出、可追溯引用、Prompt 约束与 Fallback 规则
- **AI 工程**：OpenAI API（Embedding + Chat）、向量检索与重排、质量评估指标体系
- **全栈/后端**：Next.js API Routes、REST API 设计、Supabase（PostgreSQL + pgvector）
- **学习中**：FastAPI、NestJS

---

## 项目经历

### 保险 RAG 结构化信息提取系统（个人项目）
**技术栈**：Next.js 15 + Supabase(pgvector) + OpenAI API

- 将需求从“问答机器人”重定义为“结构化信息提取”，通过 UI 强约束减少拒答场景，使条款查阅从 10–30 分钟缩短至 10–30 秒
- 设计混合检索：产品名归一化匹配 + 向量语义检索 + 结果优先级过滤/重排，降低跨产品信息污染
- 实现结构化 JSON 输出与字段级引用（sourceClauseId），缺失信息统一标记“条款未说明”，提升可控性与可追溯性
- 搭建评估体系：20 条测试集 + 6 大质量指标，字段完整率 95.8%，引用覆盖率 91.7%，P95 延迟 ≤3000ms
- 开发自动化入库流程：一键写入产品、AI 抽取 description、向量生成、条款入库与审计日志

---

## 作品与链接

- 项目仓库：https://github.com/qd-maker/insurance-rag
- GitHub： https://github.com/qd-maker
