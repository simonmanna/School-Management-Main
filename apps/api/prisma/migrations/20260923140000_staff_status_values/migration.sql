-- Staff lifecycle (audit F-31): resignation is distinct from termination, and
-- "inactive" covers a staff member kept on record but not currently working.
ALTER TYPE "StaffStatus" ADD VALUE IF NOT EXISTS 'resigned';
ALTER TYPE "StaffStatus" ADD VALUE IF NOT EXISTS 'inactive';
