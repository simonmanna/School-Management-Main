-- Wave 18 finance invariants. Every query returns the rows that VIOLATE an
-- invariant, so a healthy database returns zero rows from each.
--
--   psql "$DATABASE_URL" -f apps/api/scripts/finance-invariants.sql
--
-- Run as a role that bypasses RLS (or set app.org_id per organization).

\echo '1. Posted expense payments without a journal entry'
SELECT ep."organizationId", ep.id, ep."expenseId", ep.amount
  FROM "ExpensePayment" ep
 WHERE ep.status = 'posted' AND ep."journalEntryId" IS NULL;

\echo '2. Received income without a journal entry'
SELECT i."organizationId", i.id, i.amount
  FROM "Income" i
 WHERE i.status = 'RECEIVED' AND i."journalEntryId" IS NULL AND i."deletedAt" IS NULL;

\echo '3. Posted payments whose journal entry is missing or not in the books'
SELECT p."organizationId", p.id, p."paymentNumber", p.amount
  FROM "Payment" p
  LEFT JOIN "JournalEntry" je ON je.id = p."journalEntryId"
 WHERE p.status = 'posted'
   AND p."journalEntryId" IS NOT NULL
   AND (je.id IS NULL OR je.status NOT IN ('posted', 'reversed'));

\echo '4. Journal entries whose base debits and credits differ'
SELECT je."organizationId", je.id, je."entryNumber",
       SUM(jl."baseDebit") AS debit, SUM(jl."baseCredit") AS credit
  FROM "JournalEntry" je
  JOIN "JournalLine" jl ON jl."journalEntryId" = je.id
 GROUP BY je."organizationId", je.id, je."entryNumber"
HAVING SUM(jl."baseDebit") <> SUM(jl."baseCredit");

\echo '5. Trial balance per organization does not balance'
SELECT jl."organizationId", SUM(jl."baseDebit") AS debit, SUM(jl."baseCredit") AS credit
  FROM "JournalLine" jl
  JOIN "JournalEntry" je ON je.id = jl."journalEntryId"
 WHERE je.status IN ('posted', 'reversed')
 GROUP BY jl."organizationId"
HAVING SUM(jl."baseDebit") <> SUM(jl."baseCredit");

\echo '6. Closed cash sessions with a variance but no live variance journal'
SELECT cs."organizationId", cs.id, cs."closingDifference"
  FROM "CashSession" cs
 WHERE cs.status IN ('closed', 'reconciled')
   AND COALESCE(cs."closingDifference", 0) <> 0
   AND NOT EXISTS (
         SELECT 1 FROM "JournalEntry" je
          WHERE je."organizationId" = cs."organizationId"
            AND je."sourceType" = 'cash_session_variance'
            AND je."sourceId" = cs.id
            AND je.status = 'posted');

\echo '7. Fee money with fractional shillings (UGX organizations)'
SELECT d."organizationId", d.id, d."totalAmount"
  FROM "Document" d
  JOIN "Organization" o ON o.id = d."organizationId"
 WHERE o."currencyCode" = 'UGX'
   AND (d."totalAmount" <> ROUND(d."totalAmount") OR d."amountResidual" <> ROUND(d."amountResidual"));

\echo '8. Overlapping fiscal periods'
SELECT a."organizationId", a.id AS period_a, b.id AS period_b
  FROM "FiscalPeriod" a
  JOIN "FiscalPeriod" b
    ON a."organizationId" = b."organizationId" AND a.id < b.id
   AND a."startDate" <= b."endDate" AND b."startDate" <= a."endDate";

\echo '9. Journal entries posted into a closed or locked period after it closed'
SELECT je."organizationId", je.id, je."entryNumber", fp.name, fp.status
  FROM "JournalEntry" je
  JOIN "FiscalPeriod" fp
    ON fp."organizationId" = je."organizationId"
   AND je."postingDate" >= fp."startDate" AND je."postingDate" <= fp."endDate"
 WHERE fp.status IN ('closed', 'locked')
   AND fp."closedAt" IS NOT NULL
   AND je."postedAt" > fp."closedAt"
   AND je."sourceType" IS DISTINCT FROM 'period_close';
