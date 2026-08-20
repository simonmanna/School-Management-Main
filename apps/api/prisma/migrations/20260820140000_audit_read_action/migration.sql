-- PII-access auditing needs a distinct action for reads (e.g. revealing an
-- applicant's decrypted NIN). Additive enum value; safe.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'read' AFTER 'create';
