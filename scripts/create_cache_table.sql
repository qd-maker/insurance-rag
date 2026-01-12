-- Search Result Cache Table
-- 用于存储已搜索过的查询结果，加速重复查询

CREATE TABLE IF NOT EXISTS search_cache (
  id SERIAL PRIMARY KEY,
  query_hash VARCHAR(64) UNIQUE NOT NULL,
  query_text TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),
  hit_count INTEGER DEFAULT 0
);

-- 索引：按哈希查询
CREATE INDEX IF NOT EXISTS idx_cache_hash ON search_cache(query_hash);

-- 索引：按过期时间（用于清理）
CREATE INDEX IF NOT EXISTS idx_cache_expires ON search_cache(expires_at);

-- 清理过期缓存的函数（可通过 Supabase Scheduled Functions 定期调用）
-- DELETE FROM search_cache WHERE expires_at < NOW();
