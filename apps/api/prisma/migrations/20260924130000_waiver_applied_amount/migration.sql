-- F8: a partially applied waiver used to be re-appliable for its FULL amount,
-- forgiving the same money twice. Track what has been applied.
ALTER TABLE "Waiver" ADD COLUMN IF NOT EXISTS "appliedAmount" DECIMAL(20,6) NOT NULL DEFAULT 0;

-- Backfill from the ledger: what each waiver actually posted to the GL.
UPDATE "Waiver" w
   SET "appliedAmount" = sub.posted
  FROM (
    SELECT je."sourceId" AS waiver_id, SUM(jl."baseDebit") AS posted
      FROM "JournalEntry" je
      JOIN "JournalLine" jl ON jl."journalEntryId" = je.id
     WHERE je."sourceType" = 'school_waiver' AND je.status::text = 'posted' AND jl."baseDebit" > 0
     GROUP BY je."sourceId"
  ) sub
 WHERE w.id = sub.waiver_id;

ALTER TABLE "Waiver" ADD CONSTRAINT "Waiver_appliedAmount_range"
  CHECK ("appliedAmount" >= 0 AND "appliedAmount" <= "amount");
