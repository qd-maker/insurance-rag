# 缓存策略文档

> **版本**：v1.0  
> **更新日期**：2026-01-28  
> **适用范围**：保险产品信息结构化提取系统

---

## 1. 缓存设计概述

### 1.1 业务背景

本系统是**产品信息提取系统**，不是问答系统。用户通过下拉选择产品，系统返回该产品的结构化信息卡片。

**缓存的核心价值**：
- 减少重复的 LLM 调用成本
- 降低响应延迟（缓存命中时 <100ms）
- 提升系统吞吐量

### 1.2 缓存存储

| 属性 | 值 |
|------|-----|
| 存储位置 | Supabase `search_cache` 表 |
| 缓存键 | 产品名归一化后的字符串 |
| 缓存值 | 完整的 LLM 结构化输出 JSON |
| TTL | 24 小时 |

---

## 2. 缓存键设计

### 2.1 归一化规则

```typescript
function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\u3000]/g, '')         // 移除空格
    .replace(/[()（）［］【】\[\]·•．・。、，,._/:'""-]+/g, ''); // 移除标点
}
```

### 2.2 示例

| 原始输入 | 归一化结果（缓存键） |
|----------|---------------------|
| `安心无忧医疗险` | `安心无忧医疗险` |
| `惠民安心守护重大疾病险（旗舰版）` | `惠民安心守护重大疾病险旗舰版` |
| `康宁保 重疾险` | `康宁保重疾险` |

### 2.3 为什么以产品名为键？

1. **业务模式决定**：用户选择产品 → 获取信息卡片，不涉及自由文本查询
2. **唯一性保证**：产品名在业务上是唯一标识
3. **失效简单**：产品更新时，直接按产品名清除

---

## 3. TTL 策略

### 3.1 当前配置

```typescript
const TTL = 24 * 60 * 60 * 1000; // 24 小时
const cacheExpiry = new Date(Date.now() + TTL).toISOString();
```

### 3.2 TTL 选择依据

| 因素 | 考量 |
|------|------|
| 条款变更频率 | 保险条款更新频率低（月级），24h 足够 |
| 成本 vs 实时性 | LLM 调用成本高，优先缓存复用 |
| 主动失效兜底 | 产品更新时会主动清除，不依赖 TTL |

### 3.3 可调整性

可通过环境变量配置（待实现）：
```bash
CACHE_TTL_HOURS=24
```

---

## 4. 失效触发条件

### 4.1 自动失效

| 触发事件 | 失效行为 | 实现位置 |
|----------|----------|----------|
| 产品启用/禁用 | 清除该产品缓存 | `toggle-status/route.ts` |
| TTL 过期 | 查询时跳过过期缓存 | `search/route.ts` |

### 4.2 手动失效

| API | 方法 | 说明 |
|-----|------|------|
| `/api/admin/cache?product=产品名` | DELETE | 按产品名清除 |
| `/api/admin/cache/stats` | GET | 查看缓存统计 |

### 4.3 失效逻辑代码

```typescript
// toggle-status/route.ts
const cacheKey = getCacheKey(product.name);

// 按 query_hash 清除（精确匹配）
await supabase
  .from('search_cache')
  .delete()
  .eq('query_hash', cacheKey);

// 按 query_text 清除（兼容旧数据）
await supabase
  .from('search_cache')
  .delete()
  .ilike('query_text', `%${product.name}%`);
```

---

## 5. 缓存表结构

```sql
CREATE TABLE search_cache (
  id BIGSERIAL PRIMARY KEY,
  query_hash TEXT NOT NULL UNIQUE,    -- 缓存键（归一化产品名）
  query_text TEXT,                     -- 原始产品名（用于展示和模糊匹配）
  result JSONB NOT NULL,               -- 缓存的 LLM 输出
  expires_at TIMESTAMPTZ NOT NULL,     -- 过期时间
  hit_count INTEGER DEFAULT 0,         -- 命中次数
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cache_hash ON search_cache(query_hash);
CREATE INDEX idx_cache_expires ON search_cache(expires_at);
```

---

## 6. 运维命令

### 6.1 查看缓存统计

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/api/admin/cache"
```

响应示例：
```json
{
  "enabled": true,
  "stats": {
    "totalEntries": 15,
    "activeCount": 12,
    "expiredCount": 3,
    "totalHits": 48,
    "hitRate24h": "76.5%"
  },
  "byProduct": {
    "安心无忧医疗险": { "count": 1, "hits": 12 }
  }
}
```

### 6.2 清除指定产品缓存

```bash
curl -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/api/admin/cache?product=安心无忧医疗险"
```

响应示例：
```json
{
  "cleared": true,
  "product": "安心无忧医疗险",
  "count": 1
}
```

### 6.3 清理所有过期缓存（SQL）

```sql
DELETE FROM search_cache WHERE expires_at < NOW();
```

### 6.4 健康检查

```bash
curl "http://localhost:3000/api/health"
```

响应中包含缓存状态：
```json
{
  "checks": {
    "cache": {
      "ok": true,
      "message": "缓存系统正常 (12 活跃, 3 过期)",
      "details": {
        "enabled": true,
        "hitRate24h": "76.5%",
        "activeCount": 12,
        "expiredCount": 3
      }
    }
  }
}
```

---

## 7. 测试验证

### 7.1 缓存失效测试

```bash
npx tsx scripts/test-cache-invalidation.ts
```

测试流程：
1. 写入测试缓存
2. 按 query_hash 清除
3. 按 query_text (ilike) 清除
4. 过期缓存检测

### 7.2 手动验证流程

1. 查询产品（首次，无缓存）：响应无 `_cached` 字段
2. 再次查询同一产品：响应包含 `_cached: true`
3. 禁用该产品
4. 再次查询：响应无 `_cached` 字段（缓存已被清除）

---

## 8. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ENABLE_SEARCH_CACHE` | `false` | 是否启用缓存 |
| `ADMIN_TOKEN` | - | 管理员 API 认证 Token |

---

## 9. 注意事项

### 9.1 缓存一致性

- **强一致性不保证**：产品更新后到缓存清除之间可能有短暂的不一致窗口
- **最终一致性保证**：TTL 过期 + 主动失效双重保障

### 9.2 冷启动

- 系统重启后缓存仍然存在（持久化在 Supabase）
- 不存在缓存预热需求（按需生成）

### 9.3 缓存穿透

- 无效产品名查询不会写入缓存（仅缓存成功的 LLM 输出）
- 依赖前端下拉选择，不存在恶意查询场景

---

## 10. 未来优化方向

1. **缓存预热**：在产品列表页加载时预生成热门产品缓存
2. **分级 TTL**：热门产品更长 TTL，冷门产品更短
3. **缓存压缩**：对大型 JSON 进行 gzip 压缩存储
4. **监控告警**：缓存命中率低于阈值时告警
