-- Add 'exam_scheduled' to the AdmissionStatus enum so the admission FSM
-- (which already referenced exam_scheduled) matches the schema.
ALTER TYPE "AdmissionStatus" ADD VALUE IF NOT EXISTS 'exam_scheduled';
