-- Re-audit #9: the class leg of the clash guard compared sections with
-- COALESCE(sectionId,'') = COALESCE(sectionId,''), so a whole-class lesson and
-- a North-stream lesson in the same period were both accepted. The app check
-- (AcademicsService.conflicts) already treats NULL as "every section"; the
-- database now agrees. Existing rows are not re-validated.
CREATE OR REPLACE FUNCTION enforce_timetable_no_clash() RETURNS trigger AS $$
DECLARE clash text;
BEGIN
  -- Only lessons book a teacher, a room or a class. Free periods, breaks and
  -- other non-teaching cells are not resources and may coincide.
  IF COALESCE(NEW.type, 'lesson') <> 'lesson' THEN
    RETURN NEW;
  END IF;
  SELECT CASE
           WHEN NEW."teacherPartnerId" IS NOT NULL AND s."teacherPartnerId" = NEW."teacherPartnerId" THEN 'teacher'
           WHEN NEW."teachingRoomId" IS NOT NULL AND s."teachingRoomId" = NEW."teachingRoomId" THEN 'room'
           ELSE 'class'
         END
    INTO clash
    FROM "TimetableSlot" s
   WHERE s."organizationId" = NEW."organizationId"
     AND s.id <> NEW.id
     AND COALESCE(s.type, 'lesson') = 'lesson'
     AND s."dayOfWeek" = NEW."dayOfWeek"
     AND s."periodId" = NEW."periodId"
     AND (s.cycle = NEW.cycle OR s.cycle = 'all' OR NEW.cycle = 'all')
     AND (
          (NEW."teacherPartnerId" IS NOT NULL AND s."teacherPartnerId" = NEW."teacherPartnerId")
       OR (NEW."teachingRoomId" IS NOT NULL AND s."teachingRoomId" = NEW."teachingRoomId")
       -- A whole-class lesson (no section) occupies every section of the class;
       -- two different sections of one class may run side by side.
       OR (s."classId" = NEW."classId"
           AND (s."sectionId" IS NULL OR NEW."sectionId" IS NULL OR s."sectionId" = NEW."sectionId"))
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
  BEFORE INSERT OR UPDATE OF "teacherPartnerId", "teachingRoomId", "classId", "sectionId", "dayOfWeek", "periodId", cycle, type
  ON "TimetableSlot"
  FOR EACH ROW EXECUTE FUNCTION enforce_timetable_no_clash();
