# 项目上下文信息

- 【2026-01-09 排查中】API 500错误：embedText成功但/api/search和/api/products/check返回500。最可能原因：Supabase初始化/RPC调用失败（match_clauses函数或数据库连接）。次要原因：跨域警告（198.18.0.1代理导致）。待排查：后端详细错误堆栈、Supabase RPC函数存在性、next.config.js跨域配置。
- 【2026-01-14 紧急Bug】缓存污染导致产品混淆：查询"安心无忧医疗险"返回"星际探索意外保险"内容。疑似缓存键生成逻辑有问题,未正确隔离不同产品。需检查normalizeQuery函数和缓存键生成逻辑。
