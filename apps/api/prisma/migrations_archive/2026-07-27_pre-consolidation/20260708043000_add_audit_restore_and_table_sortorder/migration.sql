-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'restore';

-- AlterTable
ALTER TABLE "PosTable" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;
