-- Portal identity: give students and guardians a server-side identity.
--
-- Until now "User" was staff-only — no relation to StudentProfile, Partner or
-- Contact. Every student- or guardian-scoped endpoint therefore read the subject
-- id straight off the URL and trusted it, which meant any authenticated caller
-- could read or write another family's data by editing a query parameter. The
-- LMS capability guard's student branch (`req.auth?.studentProfileId`) was dead
-- code for the same reason: nothing ever populated it.
--
-- PortalIdentity is the only permitted answer to "which subject is this caller?".
-- It is resolved at login and carried as a signed token claim; request input is
-- never consulted again.
--
-- Exactly one of studentProfileId / guardianContactId is set per row, enforced by
-- a CHECK constraint. A guardian holds one row per child, so the table is a join
-- table rather than two nullable columns on User.

CREATE TABLE IF NOT EXISTS "PortalIdentity" (
    "id"                TEXT NOT NULL,
    "organizationId"    TEXT NOT NULL,
    "userId"            TEXT NOT NULL,
    "subjectType"       TEXT NOT NULL,
    "studentProfileId"  TEXT,
    "guardianContactId" TEXT,
    "revokedAt"         TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    "createdBy"         TEXT,
    CONSTRAINT "PortalIdentity_pkey" PRIMARY KEY ("id")
);

-- The invariant the application relies on: a row speaks for exactly one subject,
-- and its subjectType agrees with which column is populated. Enforced in the
-- database so no code path can create a half-formed identity.
ALTER TABLE "PortalIdentity" DROP CONSTRAINT IF EXISTS "PortalIdentity_subject_exclusive";
ALTER TABLE "PortalIdentity" ADD CONSTRAINT "PortalIdentity_subject_exclusive" CHECK (
    ("subjectType" = 'student'  AND "studentProfileId" IS NOT NULL AND "guardianContactId" IS NULL)
 OR ("subjectType" = 'guardian' AND "guardianContactId" IS NOT NULL AND "studentProfileId" IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "PortalIdentity_userId_subjectType_studentProfileId_guardianC_key"
    ON "PortalIdentity" ("userId", "subjectType", "studentProfileId", "guardianContactId");

CREATE INDEX IF NOT EXISTS "PortalIdentity_organizationId_userId_idx"
    ON "PortalIdentity" ("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "PortalIdentity_organizationId_studentProfileId_idx"
    ON "PortalIdentity" ("organizationId", "studentProfileId");
CREATE INDEX IF NOT EXISTS "PortalIdentity_organizationId_guardianContactId_idx"
    ON "PortalIdentity" ("organizationId", "guardianContactId");

ALTER TABLE "PortalIdentity" DROP CONSTRAINT IF EXISTS "PortalIdentity_userId_fkey";
ALTER TABLE "PortalIdentity" ADD CONSTRAINT "PortalIdentity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
