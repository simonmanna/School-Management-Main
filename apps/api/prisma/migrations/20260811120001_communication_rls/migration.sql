-- Communication platform — tenant-isolation policies (Phase 0 follow-on).
--
-- We create the policy + FORCE ROW LEVEL SECURITY (matching every other
-- org-scoped table's persistent shape) but deliberately do NOT
-- `ENABLE ROW LEVEL SECURITY` here: in this deployment RLS is left inert and
-- tenant isolation is enforced by the app-side Prisma tenancy extension
-- (app.org_id is only set inside interactive transactions, so a table with RLS
-- *enabled* would reject the app's ordinary standalone queries). The policy lies
-- dormant until an operator turns RLS on org-wide via `pnpm rls:setup-role`,
-- exactly like Product/Order/KitchenStation/etc.
--
-- Every table below carries a non-null organizationId. WhatsAppAuthState is
-- included even though it is only ever touched via prisma.raw (which bypasses
-- both the tenancy extension AND, when RLS is enabled, still runs as the app
-- role) — the policy is defence-in-depth for the day someone queries it through
-- the typed client.

DO $$
DECLARE
    t text;
    comm_tables text[] := ARRAY[
        'CommunicationChannel',
        'Conversation',
        'ConversationChannel',
        'ExternalIdentity',
        'ConversationParticipant',
        'Message',
        'MessageAttachment',
        'MessageDelivery',
        'ExternalMessage',
        'WhatsAppAuthState',
        'MessageTemplate',
        'CommunicationRule'
    ];
BEGIN
    FOREACH t IN ARRAY comm_tables LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.org_id'', true));',
            t
        );
    END LOOP;
END $$;
