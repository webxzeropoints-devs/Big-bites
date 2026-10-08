SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Payment'
ORDER BY ordinal_position;

SELECT migration_name, finished_at, rolled_back_at
FROM public."_prisma_migrations"
ORDER BY started_at;