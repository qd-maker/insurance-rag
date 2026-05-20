-- ============================================================
-- 审计与权限系统数据库迁移
-- 执行方式：在 Supabase SQL Editor 中运行
-- ============================================================

-- 1. products 表扩展
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. 审计日志表
CREATE TABLE IF NOT EXISTS product_audit_log (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  action TEXT NOT NULL,                    -- 'CREATE' | 'UPDATE' | 'DISABLE' | 'ENABLE' | 'ROLLBACK'
  operator TEXT NOT NULL,                  -- 操作者标识
  operator_ip TEXT,                        -- 操作者 IP（可选）
  before_snapshot JSONB,                   -- 操作前快照
  after_snapshot JSONB,                    -- 操作后快照
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT                               -- 备注
);

-- 3. 索引优化
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_audit_product_id ON product_audit_log(product_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON product_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON product_audit_log(action);

-- 4. 自动更新 updated_at 触发器
CREATE OR REPLACE FUNCTION update_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_products_updated_at ON products;
CREATE TRIGGER trigger_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_products_updated_at();

-- 5. 为现有产品补充默认值
UPDATE products SET is_active = true WHERE is_active IS NULL;
UPDATE products SET created_at = NOW() WHERE created_at IS NULL;
UPDATE products SET updated_at = NOW() WHERE updated_at IS NULL;

-- 验证
SELECT 'Migration completed!' AS status;
SELECT COUNT(*) AS total_products, COUNT(*) FILTER (WHERE is_active = true) AS active_products FROM products;
