-- ⚡ 快速修复：只更新触发器函数
-- 在 Supabase SQL Editor 中执行此文件即可修复 updated_at 错误

DROP TRIGGER IF EXISTS update_products_updated_at ON public.products;
DROP TRIGGER IF EXISTS update_clauses_updated_at ON public.clauses;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  -- 安全地更新 updated_at
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at = CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN undefined_column THEN
    -- 如果列不存在，忽略错误并返回
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_clauses_updated_at
BEFORE UPDATE ON public.clauses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
