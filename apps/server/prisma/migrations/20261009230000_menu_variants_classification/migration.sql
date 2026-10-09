DO $$ BEGIN
  CREATE TYPE "ProductClassification" AS ENUM ('VEG', 'NON_VEG', 'NOT_APPLICABLE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Category"
ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "slug" TEXT,
ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "stockUnit" TEXT NOT NULL DEFAULT 'pcs',
ADD COLUMN IF NOT EXISTS "lowStockThreshold" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "isVegetarian" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "isSignature" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "lastStockUpdatedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "classification" "ProductClassification" NOT NULL DEFAULT 'VEG',
ADD COLUMN IF NOT EXISTS "subcategory" TEXT;

UPDATE "Product"
SET "slug" = COALESCE("slug", 'legacy-' || "id"::TEXT),
    "classification" = CASE
      WHEN "isVegetarian" THEN 'VEG'::"ProductClassification"
      ELSE 'NON_VEG'::"ProductClassification"
    END
WHERE "slug" IS NULL OR "classification" = 'VEG';

ALTER TABLE "Product"
ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Product_slug_key" ON "Product"("slug");

CREATE TABLE IF NOT EXISTS "ProductVariant" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "price" DECIMAL(10,2) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "productId" INTEGER NOT NULL,
  CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductVariant_productId_name_key"
ON "ProductVariant"("productId", "name");

DO $$ BEGIN
  ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "OrderItem"
ADD COLUMN IF NOT EXISTS "variantId" INTEGER;

CREATE INDEX IF NOT EXISTS "OrderItem_variantId_idx" ON "OrderItem"("variantId");

DO $$ BEGIN
  ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
