-- D2-1: Postgres Row-Level Security (RLS).
--
-- Tenancy in this platform is enforced primarily by the Prisma client
-- extension (kernel/prisma/tenancy.extension.ts). RLS is the second line of
-- defense: even if a future code path calls prisma.raw without the extension,
-- or an operator runs an ad-hoc psql query, the database itself refuses to
-- return rows from another organization.
--
-- Mechanism: every org-scoped table has a policy that filters rows by
-- current_setting('app.org_id', true)::text. The Prisma extension sets this
-- GUC at the start of every transaction (SET LOCAL). The policies are FORCEd
-- so they apply even to the table owner.
--
-- LIMITATION: Postgres superusers bypass RLS even with FORCE. To benefit from
-- RLS the app must connect as a non-superuser role. See scripts/setup-rls-role.ts
-- which creates an `app` role and grants it table permissions; the DATABASE_URL
-- in production should point at that role.
--
-- Until that role is provisioned, this migration is a no-op at runtime — the
-- policies exist but the connection bypasses them. That's intentional: the
-- migration is safe to apply to any environment.

-- Helper: enable RLS + create policy on a single table.
DO $$
DECLARE
    t text;
    policy_tables text[] := ARRAY[
        'User',
        'Role',
        'RefreshToken',
        'AuditLog',
        'Partner',
        'PartnerCategory',
        'Contact',
        'Address',
        'Product',
        'ProductCategory',
        'UnitOfMeasure',
        'Tax',
        'FiscalPeriod',
        'Branch',
        'Account',
        'Journal',
        'JournalEntry',
        'JournalLine',
        'AccountMapping',
        'BankAccount',
        'Document',
        'DocumentLine',
        'Payment',
        'PaymentAllocation',
        'InventoryLocation',
        'StockItem',
        'InventoryBatch',
        'InventoryLedger',
        'CashRegister',
        'CashSession',
        'CashMovement',
        'IdempotencyRecord'
    ];
BEGIN
    FOREACH t IN ARRAY policy_tables
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I
             USING ("organizationId" = current_setting(''app.org_id'', true))',
            t
        );
    END LOOP;
END $$;