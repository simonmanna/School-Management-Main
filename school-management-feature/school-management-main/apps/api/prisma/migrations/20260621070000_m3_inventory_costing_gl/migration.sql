-- M3 — Inventory → GL integration with per-product costing (AVCO / FIFO / STANDARD).

-- CreateEnum
CREATE TYPE "CostingMethod" AS ENUM ('AVCO', 'FIFO', 'STANDARD');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "costingMethod" "CostingMethod" NOT NULL DEFAULT 'AVCO';

-- AlterTable
ALTER TABLE "StockItem" ADD COLUMN "runningAverageCost" DECIMAL(20,6) NOT NULL DEFAULT 0;