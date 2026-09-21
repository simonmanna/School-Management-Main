-- Capacity enforcement with an audited override (ADR-030, brief §11).
--
-- Capacity becomes a rule: a placement that would overfill a class or stream is
-- refused unless the caller holds `school:enrollment:capacity:override` and gives
-- a reason. These columns put that decision on the placement itself, next to the
-- audit row, so "who seated the 41st pupil in P5, and why" has an answer.

ALTER TABLE "EnrollmentPlacement"
  ADD COLUMN IF NOT EXISTS "capacityOverriddenById" TEXT,
  ADD COLUMN IF NOT EXISTS "capacityOverrideReason" TEXT;

-- ── permission backfill ──────────────────────────────────────────────────────
-- PermissionsGuard ANDs its requirements, so an ungranted new permission is an
-- outage for every registrar the day it ships. It goes to the roles that already
-- hold the authority it splits out of: whoever may place learners, and whoever
-- configures the cohorts whose capacity is being exceeded.
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:enrollment:capacity:override')
  WHERE NOT ('school:enrollment:capacity:override' = ANY("permissions"))
    AND ('school:enrollment:write' = ANY("permissions") OR 'school:programmes:write' = ANY("permissions"));
