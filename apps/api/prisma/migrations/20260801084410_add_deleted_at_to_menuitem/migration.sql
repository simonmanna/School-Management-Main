-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MenuItem_organizationId_deletedAt_idx" ON "MenuItem"("organizationId", "deletedAt");
