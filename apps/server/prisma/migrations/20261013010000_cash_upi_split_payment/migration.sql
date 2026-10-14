ALTER TYPE "PaymentMethod" ADD VALUE 'CASH_UPI';

ALTER TABLE "Payment"
  ADD COLUMN "cashAmount" DECIMAL(10, 2),
  ADD COLUMN "upiAmount" DECIMAL(10, 2);
