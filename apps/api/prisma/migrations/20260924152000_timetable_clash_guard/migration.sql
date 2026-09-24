-- Wave 4 · the database refuses a double-booked timetable slot.
--
-- A teacher, a room, or a class (and section) cannot be in two lessons in the
-- same day/period of overlapping cycles ('all' overlaps 'A' and 'B'). The
-- service took an advisory lock and checked in application code; this is the
-- backstop.
--
-- A trigger rather than a unique/EXCLUDE constraint: the DEMO tenant's seed
-- already holds 74 teacher and 4 class clashes (pre-check 2026-09-24), and a
-- constraint would have to validate them. The guard applies to every NEW or
-- CHANGED slot; the existing clashes are reported for the school to resolve.
CREATE OR REPLACE FUNCTION enforce_timetable_no_clash() RETURNS trigger AS $$
DECLARE clash text;
BEGIN
  SELECT CASE
           WHEN NEW."teacherPartnerId" IS NOT NULL AND s."teacherPartnerId" = NEW."teacherPartnerId" THEN 'teacher'
           WHEN NEW."teachingRoomId" IS NOT NULL AND s."teachingRoomId" = NEW."teachingRoomId" THEN 'room'
           ELSE 'class'
         END
    INTO clash
    FROM "TimetableSlot" s
   WHERE s."organizationId" = NEW."organizationId"
     AND s.id <> NEW.id
     AND s."dayOfWeek" = NEW."dayOfWeek"
     AND s."periodId" = NEW."periodId"
     AND (s.cycle = NEW.cycle OR s.cycle = 'all' OR NEW.cycle = 'all')
     AND (
          (NEW."teacherPartnerId" IS NOT NULL AND s."teacherPartnerId" = NEW."teacherPartnerId")
       OR (NEW."teachingRoomId" IS NOT NULL AND s."teachingRoomId" = NEW."teachingRoomId")
       OR (s."classId" = NEW."classId" AND COALESCE(s."sectionId", '') = COALESCE(NEW."sectionId", ''))
     )
   LIMIT 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'Timetable clash: the % is already booked on day % in this period', clash, NEW."dayOfWeek"
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS timetable_no_clash ON "TimetableSlot";
CREATE TRIGGER timetable_no_clash
  BEFORE INSERT OR UPDATE OF "teacherPartnerId", "teachingRoomId", "classId", "sectionId", "dayOfWeek", "periodId", cycle
  ON "TimetableSlot"
  FOR EACH ROW EXECUTE FUNCTION enforce_timetable_no_clash();
