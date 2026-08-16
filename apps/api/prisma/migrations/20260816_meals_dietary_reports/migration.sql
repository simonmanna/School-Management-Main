-- School Meals P0-P2: dietary requirements field + (reports use existing tables only).

-- 1) Add dietaryRequirements JSONB to MedicalRecord (separate from allergies).
ALTER TABLE "MedicalRecord" ADD COLUMN IF NOT EXISTS "dietaryRequirements" JSONB NOT NULL DEFAULT '[]';
