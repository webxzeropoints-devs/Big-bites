CREATE TABLE "OrderItemSubmission" (
    "orderId" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemSubmission_pkey" PRIMARY KEY ("orderId", "idempotencyKey")
);

ALTER TABLE "OrderItemSubmission"
ADD CONSTRAINT "OrderItemSubmission_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;