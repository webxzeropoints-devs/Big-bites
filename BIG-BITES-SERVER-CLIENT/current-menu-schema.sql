SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('Category', 'Product')
ORDER BY table_name, ordinal_position;
