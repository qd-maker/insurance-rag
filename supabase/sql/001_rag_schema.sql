-- ============================================================
-- RAG 系统完整 SQL 初始化脚本（幂等）
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ============ Products 表 ============
CREATE TABLE IF NOT EXISTS public.products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============ Clauses 表（条款内容 + 向量） ============
CREATE TABLE IF NOT EXISTS public.clauses (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES public.products(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============ 向量索引 ============
-- 使用 HNSW 索引替代 IVFFlat，内存占用更低
-- HNSW 对 Supabase 的 maintenance_work_mem 限制（32 MB）更友好
CREATE INDEX IF NOT EXISTS clauses_embedding_idx
ON public.clauses USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- ============ match_clauses RPC 函数 ============
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

-- ============ 行级安全（RLS）策略 ============
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clauses ENABLE ROW LEVEL SECURITY;

-- Products 表：Service Role 可读
CREATE POLICY "service_role_read_products"
ON public.products
FOR SELECT
TO service_role
USING (true);

-- Clauses 表：Service Role 可读写
CREATE POLICY "service_role_read_clauses"
ON public.clauses
FOR SELECT
TO service_role
USING (true);

CREATE POLICY "service_role_insert_clauses"
ON public.clauses
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "service_role_update_clauses"
ON public.clauses
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "service_role_delete_clauses"
ON public.clauses
FOR DELETE
TO service_role
USING (true);

-- ============ 触发器：自动更新 updated_at ============
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_products_updated_at ON public.products;
CREATE TRIGGER update_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_clauses_updated_at ON public.clauses;
CREATE TRIGGER update_clauses_updated_at
BEFORE UPDATE ON public.clauses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

