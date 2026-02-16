-- ============================================================
-- 迁移脚本：embedding 维度 1536 → 1024
-- 适用：切换 embedding 模型为 qwen3-embedding-4b (1024维)
-- ⚠️ 执行后需重新生成所有向量（npx tsx scripts/regenerate-vectors.ts）
-- ============================================================

-- 1. 删除旧 HNSW 索引（维度不兼容，必须先删）
DROP INDEX IF EXISTS clauses_embedding_idx;

-- 2. 清空旧向量数据（1536维不可复用）
UPDATE public.clauses SET embedding = NULL;

-- 3. 修改列类型为 1024 维
ALTER TABLE public.clauses ALTER COLUMN embedding TYPE vector(1024);

-- 4. 重建 match_clauses RPC 函数（参数维度 → 1024）
CREATE OR REPLACE FUNCTION public.match_clauses(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10
)
RETURNS TABLE(
  id BIGINT,
  product_id BIGINT,
  content TEXT,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.product_id,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.clauses c
  WHERE 1 - (c.embedding <=> query_embedding) >= match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 5. 重建 HNSW 索引（1024维）
CREATE INDEX IF NOT EXISTS clauses_embedding_idx
ON public.clauses USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
