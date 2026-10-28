ALTER TABLE "Product"
	ADD COLUMN IF NOT EXISTS "stock" INTEGER NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS "stockUnit" TEXT NOT NULL DEFAULT 'pcs',
	ADD COLUMN IF NOT EXISTS "lowStockThreshold" INTEGER NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS "lastStockUpdatedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ProductStockMovement" (
	"id" SERIAL NOT NULL,
	"productId" INTEGER NOT NULL,
	"orderId" INTEGER,
	"movementType" TEXT NOT NULL DEFAULT 'ADJUSTMENT',
	"quantity" INTEGER NOT NULL,
	"previousStock" INTEGER NOT NULL,
	"newStock" INTEGER NOT NULL,
	"reason" TEXT NOT NULL DEFAULT '',
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "ProductStockMovement_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'ProductStockMovement_productId_fkey'
			AND conrelid = '"ProductStockMovement"'::regclass
	) THEN
		ALTER TABLE "ProductStockMovement"
			ADD CONSTRAINT "ProductStockMovement_productId_fkey"
			FOREIGN KEY ("productId") REFERENCES "Product"("id")
			ON DELETE RESTRICT ON UPDATE CASCADE;
	END IF;
END
$$;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'ProductStockMovement_orderId_fkey'
			AND conrelid = '"ProductStockMovement"'::regclass
	) THEN
		ALTER TABLE "ProductStockMovement"
			ADD CONSTRAINT "ProductStockMovement_orderId_fkey"
			FOREIGN KEY ("orderId") REFERENCES "Order"("id")
			ON DELETE SET NULL ON UPDATE CASCADE;
	END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "ProductStockMovement_orderId_idx"
ON "ProductStockMovement"("orderId");
