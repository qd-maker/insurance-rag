-- ============================================================
-- 迁移脚本：embedding 维度 1024 → 1536
-- 适用：切换 embedding 模型为 text-embedding-3-small (1536维)
-- ⚠️ 执行后需重新生成所有向量（npm run regenerate:vectors）
-- ============================================================

-- 1. 删除旧 HNSW 索引（维度不兼容，必须先删）
DROP INDEX IF EXISTS public.clauses_embedding_idx;

-- 2. 清空旧向量数据（1024维不可复用）
UPDATE public.clauses SET embedding = NULL;

-- 3. 修改列类型为 1536 维
ALTER TABLE public.clauses ALTER COLUMN embedding TYPE vector(1536);

-- 4. 重建 match_clauses RPC 函数（参数维度 → 1536）
CREATE OR REPLACE FUNCTION public.match_clauses(
  query_embedding vector(1536),
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

-- 5. 重建 HNSW 索引（1536维）
CREATE INDEX IF NOT EXISTS clauses_embedding_idx
ON public.clauses USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
