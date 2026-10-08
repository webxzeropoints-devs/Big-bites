DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Order" AS orders
    JOIN "User" AS users ON users.id = orders."waiterId"
    WHERE users.role::text = 'MANAGER'
  ) THEN
    RAISE EXCEPTION
      'Cannot remove MANAGER users while orders reference them. Reassign those orders to a WAITER account, then rerun the migration.';
  END IF;
END $$;

DELETE FROM "User"
WHERE role::text = 'MANAGER';

CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'CASHIER', 'WAITER');

ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "UserRole_new"
  USING ("role"::text)::"UserRole_new";

DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
