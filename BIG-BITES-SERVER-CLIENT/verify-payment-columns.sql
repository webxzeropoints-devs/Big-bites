SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Payment'
  AND column_name IN ('amountReceived', 'change')
ORDER BY column_name;