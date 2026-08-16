-- Timetable P0: break/free period types, substitution, and per-grid publishing.
ALTER TABLE "TimetableSlot" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'lesson';
ALTER TABLE "TimetableSlot" ADD COLUMN "substituteTeacherId" TEXT;
ALTER TABLE "TimetableSlot" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "TimetableSlot_teacherPartnerId_idx" ON "TimetableSlot" ("teacherPartnerId");
CREATE INDEX "TimetableSlot_room_idx" ON "TimetableSlot" ("room");
CREATE INDEX "TimetableSlot_subjectId_idx" ON "TimetableSlot" ("subjectId");
