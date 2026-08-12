-- Custom SQL preserved from the pre-squash migration history
-- (see prisma/migrations-archive for the original folders):
--   * 20260621120000_d2_rls            — tenant-isolation RLS on 32 org-scoped tables
--   * 20260628000000_pos_tables        — RLS on the 3 POS table-management tables
--   * 20260622160000_phase_f6_...      — DomainEventLog append-only triggers
--
-- Tenancy is enforced primarily by the Prisma client extension
-- (kernel/prisma/tenancy.extension.ts). RLS is the second line of defense:
-- even if a code path calls prisma.raw without the extension, or an operator
-- runs an ad-hoc psql query, the database refuses rows from another org.
--
-- LIMITATION: Postgres superusers bypass RLS even with FORCE. In production
-- the app must connect as a non-superuser role (see scripts/setup-rls-role.ts).

-- ---------------------------------------------------------------------------
-- 1. Tenant-isolation RLS (D2-1 pattern)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2. RLS on POS table-management tables (mirrors the D2-1 pattern)
-- ---------------------------------------------------------------------------
ALTER TABLE "PosTable"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosTableOrder"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosTableReservation" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "PosTable"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "PosTableOrder"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "PosTableReservation" FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='tenant_isolation_pos_table') THEN
    CREATE POLICY tenant_isolation_pos_table ON "PosTable"
      USING ("organizationId" = current_setting('app.org_id', true))
      WITH CHECK ("organizationId" = current_setting('app.org_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='tenant_isolation_pos_table_order') THEN
    CREATE POLICY tenant_isolation_pos_table_order ON "PosTableOrder"
      USING ("organizationId" = current_setting('app.org_id', true))
      WITH CHECK ("organizationId" = current_setting('app.org_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='tenant_isolation_pos_table_reservation') THEN
    CREATE POLICY tenant_isolation_pos_table_reservation ON "PosTableReservation"
      USING ("organizationId" = current_setting('app.org_id', true))
      WITH CHECK ("organizationId" = current_setting('app.org_id', true));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. DomainEventLog append-only enforcement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deny_modify_domain_event_log() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'DomainEventLog is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deny_update_domain_event_log ON "DomainEventLog";
CREATE TRIGGER deny_update_domain_event_log BEFORE UPDATE ON "DomainEventLog"
  FOR EACH ROW EXECUTE FUNCTION deny_modify_domain_event_log();
DROP TRIGGER IF EXISTS deny_delete_domain_event_log ON "DomainEventLog";
CREATE TRIGGER deny_delete_domain_event_log BEFORE DELETE ON "DomainEventLog"
  FOR EACH ROW EXECUTE FUNCTION deny_modify_domain_event_log();
