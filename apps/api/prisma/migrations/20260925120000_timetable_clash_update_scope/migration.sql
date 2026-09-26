-- Re-audit #3 P1-17: an UPDATE that only releases resources must not be
-- re-checked. Staff offboarding clears the teacher from their lessons
-- (UPDATE ... SET "teacherPartnerId" = NULL). The trigger fired on that column
-- and then ran the CLASS leg against the row's unchanged slot, so a lesson
-- that clashed under the stricter section rule of 20260925110000 (existing rows
-- were never re-validated) made the whole offboarding transaction roll back —
-- and the outbox retried it forever.
--
-- On UPDATE the row is re-checked only when it claims something new: a
-- different slot (day, period, cycle, class, section, type) or a non-null
-- teacher/room it did not hold before. Freeing a teacher or a room claims
-- nothing and cannot create a clash. INSERTs are checked exactly as before.
CREATE OR REPLACE FUNCTION enforce_timetable_no_clash() RETURNS trigger AS $$
DECLARE clash text;
BEGIN
  -- Only lessons book a teacher, a room or a class. Free periods, breaks and
  -- other non-teaching cells are not resources and may coincide.
  IF COALESCE(NEW.type, 'lesson') <> 'lesson' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW."dayOfWeek" = OLD."dayOfWeek"
     AND NEW."periodId" = OLD."periodId"
     AND NEW.cycle = OLD.cycle
     AND NEW."classId" = OLD."classId"
     AND NEW."sectionId" IS NOT DISTINCT FROM OLD."sectionId"
     AND COALESCE(NEW.type, 'lesson') = COALESCE(OLD.type, 'lesson')
     AND (NEW."teacherPartnerId" IS NULL OR NEW."teacherPartnerId" IS NOT DISTINCT FROM OLD."teacherPartnerId")
     AND (NEW."teachingRoomId" IS NULL OR NEW."teachingRoomId" IS NOT DISTINCT FROM OLD."teachingRoomId")
  THEN
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
