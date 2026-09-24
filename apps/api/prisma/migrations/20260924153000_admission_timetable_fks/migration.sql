-- Wave 4 · loose ids become real foreign keys, and seat counters cannot go
-- negative. Pre-check: 0 orphans in every column below; 0 negative counters.

ALTER TABLE "AdmissionCapacity" DROP CONSTRAINT IF EXISTS "AdmissionCapacity_counters_nonneg";
ALTER TABLE "AdmissionCapacity" ADD CONSTRAINT "AdmissionCapacity_counters_nonneg"
  CHECK ("capacity" >= 0 AND "reservedCapacity" >= 0 AND "claimedSeats" >= 0);

ALTER TABLE "TimetableOverride" DROP CONSTRAINT IF EXISTS "TimetableOverride_teacherPartnerId_fkey";
ALTER TABLE "TimetableOverride" ADD CONSTRAINT "TimetableOverride_teacherPartnerId_fkey"
  FOREIGN KEY ("teacherPartnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimetableOverride" DROP CONSTRAINT IF EXISTS "TimetableOverride_subjectId_fkey";
ALTER TABLE "TimetableOverride" ADD CONSTRAINT "TimetableOverride_subjectId_fkey"
  FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdmissionCapacity" DROP CONSTRAINT IF EXISTS "AdmissionCapacity_classId_fkey";
ALTER TABLE "AdmissionCapacity" ADD CONSTRAINT "AdmissionCapacity_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitingList" DROP CONSTRAINT IF EXISTS "WaitingList_classId_fkey";
ALTER TABLE "WaitingList" ADD CONSTRAINT "WaitingList_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdmissionApplication" DROP CONSTRAINT IF EXISTS "AdmissionApplication_parentContactId_fkey";
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_parentContactId_fkey"
  FOREIGN KEY ("parentContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same-organization guard on the new FKs: re-run the catalog installer from
-- 20260923110000_tenant_fk_guard (idempotent; covers every qualifying FK).
DO $$
DECLARE r record; trg text; n integer := 0;
BEGIN
  FOR r IN
    SELECT con.conname, child.relname AS child_tbl, ca.attname AS fk_col, parent.relname AS parent_tbl
      FROM pg_constraint con
      JOIN pg_class child   ON child.oid  = con.conrelid
      JOIN pg_class parent  ON parent.oid = con.confrelid
      JOIN pg_namespace ns  ON ns.oid = child.relnamespace
      JOIN pg_attribute ca  ON ca.attrelid = con.conrelid  AND ca.attnum = con.conkey[1]
      JOIN pg_attribute pa  ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
     WHERE con.contype = 'f' AND ns.nspname = 'public'
       AND array_length(con.conkey, 1) = 1 AND pa.attname = 'id' AND ca.attname <> 'organizationId'
       AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = child.oid  AND x.attname = 'organizationId' AND NOT x.attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = parent.oid AND x.attname = 'organizationId' AND NOT x.attisdropped)
  LOOP
    trg := 'tenant_fk_' || left(md5(r.conname), 24);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trg, r.child_tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION enforce_same_org_fk(%L, %L)',
      trg, r.fk_col, r.child_tbl, r.fk_col, r.parent_tbl);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'same-org FK guard (re)installed on % foreign key(s)', n;
END $$;
