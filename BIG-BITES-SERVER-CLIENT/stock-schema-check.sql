SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'Product' AND column_name IN ('stock', 'stockUnit', 'lowStockThreshold', 'lastStockUpdatedAt'))
    OR table_name = 'ProductStockMovement'
  )
ORDER BY table_name, ordinal_position;
