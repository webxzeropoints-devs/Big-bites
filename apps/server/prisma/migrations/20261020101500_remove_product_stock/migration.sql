DROP TABLE IF EXISTS "ProductStockMovement";

ALTER TABLE "Product"
  DROP COLUMN IF EXISTS "stock",
  DROP COLUMN IF EXISTS "stockUnit",
  DROP COLUMN IF EXISTS "lowStockThreshold",
  DROP COLUMN IF EXISTS "lastStockUpdatedAt";
