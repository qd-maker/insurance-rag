# Week 1 手动验证指南

## 1. 验证日志系统

### 步骤1：启动开发服务器
```bash
npm run dev
```

### 步骤2：发起一次查询
在浏览器访问 http://localhost:3000，输入：
- 选择产品：安心无忧医疗险
- 问题：这个产品的免赔额是多少

### 步骤3：检查日志文件
```bash
# 查看今天的日志文件
cat logs/query_20260111.jsonl

# 或使用PowerShell
Get-Content logs/query_20260111.jsonl | ConvertFrom-Json | Format-List
```

### 期望结果
日志应包含：
- timestamp: 当前时间
- query: 你输入的问题
- product_matched: "安心无忧医疗险"
- duration_ms: 总耗时（通常1000-3000ms）
- embedding_ms: Embedding耗时（通常100-500ms）
- llm_ms: LLM耗时（通常800-2000ms）
- tokens_used: { prompt: xxx, completion: xxx }
- retrieved_chunks: 检索到的条款片段

---

## 2. 手动运行评估（部分测试）

### 创建简化测试脚本
创建 `scripts/test-single.ts`：

```typescript
async function testSingle() {
  const API_URL = 'http://localhost:3000/api/search';
  
  const testCases = [
    { plan: '安心无忧医疗险', question: '免赔额是多少', expected: '安心无忧医疗险' },
    { plan: '平安福', question: '保额是多少', expected: '应拒答' },
  ];

  for (const tc of testCases) {
    console.log(`\n测试: ${tc.question}`);
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `【${tc.plan}】${tc.question}` }),
    });

    const result = await response.json();
    console.log(`结果: ${result.productName || '未识别'}`);
    console.log(`引用数: ${result.sources?.length || 0}`);
  }
}

testSingle();
```

运行：
```bash
npx tsx scripts/test-single.ts
```

---

## 3. 检查API响应格式

### 使用curl测试
```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"【安心无忧医疗险】免赔额是多少\"}" \
  | jq .
```

### 期望响应
```json
{
  "productName": "安心无忧医疗险",
  "overview": "...",
  "coreCoverage": [...],
  "exclusions": [...],
  "salesScript": [...],
  "rawTerms": "...",
  "sources": [
    {
      "clauseId": 1,
      "productName": "安心无忧医疗险"
    }
  ]
}
```

---

## 4. 验证日志字段完整性

### 检查清单
打开 `logs/query_YYYYMMDD.jsonl`，验证每条日志包含：

- [ ] timestamp（ISO 8601格式）
- [ ] query（用户问题）
- [ ] product_matched（匹配的产品名）
- [ ] retrieved_chunks（至少包含id, similarity, snippet）
- [ ] top_k（检索数量，通常10）
- [ ] duration_ms（总耗时，数字）
- [ ] embedding_ms（Embedding耗时，数字）
- [ ] llm_ms（LLM耗时，数字）
- [ ] tokens_used.prompt（prompt tokens，数字）
- [ ] tokens_used.completion（completion tokens，数字）
- [ ] should_refuse（布尔值）
- [ ] refuse_reason（如有拒答，应有原因）

---

## 5. 性能基准验证

### 预期性能指标
- **Embedding耗时**: 100-500ms
- **LLM耗时**: 800-2000ms
- **总耗时**: 1000-3000ms
- **Token消耗**: 
  - Prompt: 500-1500 tokens
  - Completion: 200-600 tokens

### 如何优化
如果超出预期：
1. **Embedding慢**：考虑缓存或使用更快的模型
2. **LLM慢**：降低temperature或使用更小的模型
3. **Token过多**：优化context长度

---

## 6. 完整评估运行（30条）

### 前提条件
- [ ] 开发服务器运行（npm run dev）
- [ ] 数据库有4个产品的数据
- [ ] eval_set.csv 有30条测试用例

### 运行命令
```bash
npx tsx scripts/eval.ts > eval-output.txt 2>&1
```

### 预期输出
```
🚀 开始评估...
📋 加载 30 条测试用例

[1/30] 测试: 这个产品的免赔额是多少
  ✅ 产品匹配且有引用

[2/30] 测试: 康宁保的保额是多少
  ✅ 产品匹配且有引用

...

[21/30] 测试: 保额是多少
  ✅ 正确拒答

...

============================================================
📊 评估报告
============================================================
总测试数: 30

Group A（精确输入）准确率: 90.0% (9/10)
Group B（模糊输入）准确率: 70.0% (7/10)
Group C（拒答场景）准确率: 30.0% (3/10)  ← 预期较低，Week 5优化

整体准确率: 63.3%
引用完整性: 95.0%
============================================================

💾 详细报告已保存至: outputs/eval_result_20260111.json
```

### 解读baseline结果
- **Group A高**：基本功能OK
- **Group B中等**：需Week 2优化（别名映射）
- **Group C低**：正常，Week 5会实现拒答机制
- **引用完整性高**：说明RAG工作良好

---

## 7. Week 1验收

完成以下所有项即可进入Week 2：

- [ ] 日志文件存在且格式正确
- [ ] 手动测试API返回正确结果
- [ ] 日志记录了完整字段
- [ ] 评估脚本能运行（即使部分失败也OK）
- [ ] 有baseline报告JSON文件

---

## 面试准备

### Week 1成果演示话术
> "在Week 1，我建立了系统的可观测性基础设施：
> 
> 1. **日志系统**：每次查询记录12个关键指标，写入本地JSONL文件，方便后续分析
> 2. **评估体系**：30条测试集覆盖3类场景，自动化脚本一键运行
> 3. **Baseline建立**：首次评估发现Group A准确率90%，说明基本功能稳定；Group C拒答率低，符合预期，将在Week 5优化
> 
> 这套基础设施让我能够：
> - 每次改代码都跑评估，快速发现回归
> - 通过日志定位性能瓶颈
> - 用数据证明系统在变好，而不是凭感觉"
