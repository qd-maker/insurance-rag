-- 清空数据库中的所有产品和条款数据
-- 在 Supabase SQL Editor 中执行

-- 1. 删除所有条款(会级联删除向量)
DELETE FROM clauses;

-- 2. 删除所有产品
DELETE FROM products;

-- 3. 清空缓存
DELETE FROM search_cache;

-- 4. 重置序列(可选)
ALTER SEQUENCE products_id_seq RESTART WITH 1;
ALTER SEQUENCE clauses_id_seq RESTART WITH 1;
