CREATE TYPE "DiscountType" AS ENUM ('AMOUNT', 'PERCENTAGE');

ALTER TABLE "Order"
ADD COLUMN "discountType" "DiscountType",
ADD COLUMN "discountValue" DECIMAL(10,2),
ADD COLUMN "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
