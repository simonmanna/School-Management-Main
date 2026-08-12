-- P0-11: mustChangePassword flag for the initial admin (and any other
-- user created with a temporary password). The web app reads this on
-- login and redirects the user to a change-password flow until the
-- flag is cleared.
--
-- Default false — existing users are not forced to rotate. New seed
-- users (and any future "invite" flow) get true on creation.

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "User_mustChangePassword_idx" ON "User"("mustChangePassword");
