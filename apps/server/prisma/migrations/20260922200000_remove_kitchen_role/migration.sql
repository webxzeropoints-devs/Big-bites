CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'MANAGER', 'CASHIER', 'WAITER');

ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "UserRole_new"
  USING (
    CASE
      WHEN "role"::text = 'KITCHEN' THEN 'WAITER'
      ELSE "role"::text
    END
  )::"UserRole_new";

DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
