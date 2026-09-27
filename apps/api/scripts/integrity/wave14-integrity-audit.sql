-- Wave 14 existing-data integrity audit (plan Phase 4.5).
--
-- READ ONLY. Finds records written before the Wave 14 fixes that the fixed code
-- would have refused. Nothing is changed here: each finding is reviewed by a
-- person and corrected through the application (reversal, merge procedure,
-- re-release), never with ad-hoc SQL.
--
--   psql "$BACKUP_DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/scripts/integrity/wave14-integrity-audit.sql
--
-- Run AFTER the Wave 14 migrations, as a BYPASSRLS role so every school is seen. Every query reports a count
-- and up to 20 examples; a clean database reports 0 everywhere.

BEGIN TRANSACTION READ ONLY;
SET LOCAL row_security = off;

\echo '== I-001 likely duplicate pupils (same school, same name, same date of birth)'
SELECT sp."organizationId", lower(btrim(regexp_replace(p."name", '\s+', ' ', 'g'))) AS name, sp."dateOfBirth"::date AS dob,
       count(*) AS records, string_agg(sp."admissionNo", ', ' ORDER BY sp."admissionNo") AS admission_numbers
  FROM "StudentProfile" sp JOIN "Partner" p ON p."id" = sp."partnerId"
 WHERE sp."dateOfBirth" IS NOT NULL AND sp."status" NOT IN ('archived', 'deceased')
 GROUP BY 1, 2, 3 HAVING count(*) > 1
 ORDER BY records DESC LIMIT 20;

\echo '== I-020 adjustments posted more than once'
SELECT je."organizationId", je."sourceId" AS adjustment_id, count(*) AS journals
  FROM "JournalEntry" je
 WHERE je."sourceType" = 'school_fee_adjustment'
 GROUP BY 1, 2 HAVING count(*) > 1 LIMIT 20;

\echo '== I-022 adjustment pupil differs from invoice pupil'
SELECT fa."organizationId", fa."code", fa."status", fa."studentProfileId" AS adjustment_pupil, sfi."studentProfileId" AS invoice_pupil
  FROM "FeeAdjustment" fa JOIN "SchoolFeeInvoice" sfi ON sfi."documentId" = fa."documentId"
 WHERE fa."studentProfileId" <> sfi."studentProfileId" LIMIT 20;

\echo '== I-021 fee invoices posted after their term was financially closed'
SELECT d."organizationId", d."documentNumber", d."postedAt", tfc."closedAt", sfi."termId"
  FROM "SchoolFeeInvoice" sfi
  JOIN "Document" d ON d."id" = sfi."documentId"
  JOIN "TermFinancialClose" tfc ON tfc."organizationId" = sfi."organizationId" AND tfc."termId" = sfi."termId"
 WHERE tfc."status" = 'closed' AND d."postedAt" IS NOT NULL AND d."postedAt" > tfc."closedAt"
 LIMIT 20;

\echo '== I-023 cash receipts with no drawer movement (by school and custody mode)'
SELECT pay."organizationId", coalesce(sp."cashCustodyMode", 'cashbook') AS mode,
       count(*) AS receipts, sum(pay."amount") AS amount
  FROM "Payment" pay
  LEFT JOIN "SchoolProfile" sp ON sp."organizationId" = pay."organizationId"
 WHERE pay."direction" = 'inbound' AND pay."paymentMethod" = 'cash' AND pay."status" = 'posted'
   AND NOT EXISTS (SELECT 1 FROM "CashMovement" cm WHERE cm."paymentId" = pay."id")
 GROUP BY 1, 2 ORDER BY amount DESC LIMIT 20;

\echo '== I-030 schools with late marks but no late policy (ADR-032 P1: choose one in School settings)'
SELECT sa."organizationId", count(*) AS late_marks
  FROM "StudentAttendance" sa
  JOIN "AttendanceStatusConfig" c ON c."organizationId" = sa."organizationId" AND c."code" = sa."status" AND c."isLate"
  LEFT JOIN "SchoolProfile" sp ON sp."organizationId" = sa."organizationId"
 WHERE sp."attendanceLateContribution" IS NULL
 GROUP BY 1 LIMIT 20;

\echo '== I-040 releases recorded before authority was stored (legacy override rows with no reason)'
SELECT pe."organizationId", count(*) AS releases
  FROM "PickupEvent" pe
 WHERE pe."authorizationSource" = 'override' AND (pe."overrideReason" IS NULL OR btrim(pe."overrideReason") = '')
 GROUP BY 1 LIMIT 20;

\echo '== I-010 teacher roles that will now see nothing (class/own scope, no staff record) — check assignments before go-live'
SELECT r."organizationId", r."name" AS role, count(u."id") AS users_without_staff_record
  FROM "Role" r
  JOIN "_UserRoles" ru ON ru."A" = r."id"
  JOIN "User" u ON u."id" = ru."B"
 WHERE r."dataScope" IN ('class', 'own')
   AND NOT EXISTS (SELECT 1 FROM "HrEmployee" e WHERE e."userId" = u."id")
 GROUP BY 1, 2 LIMIT 20;

ROLLBACK;
