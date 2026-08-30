-- Fix for auth 500 (P2022): Role.dataScope column missing in the live DB.
-- The RBAC commit added `dataScope RoleDataScope @default(school)` to the
-- `Role` model in schema.prisma but no migration was applied, so every
-- `prisma.user.findFirst({ include: { roles: true } })` (used by both
-- /auth/login and /auth/refresh) throws "column Role.dataScope does not exist".
-- This brings the database up to the current schema for that column.

-- CreateEnum
CREATE TYPE "RoleDataScope" AS ENUM ('own', 'class', 'department', 'school');

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "dataScope" "RoleDataScope" NOT NULL DEFAULT 'school';
