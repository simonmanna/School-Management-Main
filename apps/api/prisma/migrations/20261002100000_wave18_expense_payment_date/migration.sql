-- Wave 18: expense payments carry their own value date; the journal is dated with it.
ALTER TABLE "ExpensePayment" ADD COLUMN "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "ExpensePayment" SET "paymentDate" = "createdAt";
