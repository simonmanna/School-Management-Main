-- Wave 4 · A5: the implicit User<->Role join ("_UserRoles": A = Role.id,
-- B = User.id) carried no organization, no RLS and no same-org check, so a
-- role of School B could be attached to a user of School A (the S2 escalation
-- path, closed in the service in Wave 1, still open at the database).
--
-- Replacing it with an explicit model would rewrite every `roles: { connect }`
-- write in the codebase. The same guarantees are added in place instead:
--   1. a trigger refuses a row whose role and user belong to different orgs;
--   2. RLS: a row is visible only when its role belongs to the current org.
-- Pre-check: 0 cross-org rows.

CREATE OR REPLACE FUNCTION enforce_user_role_same_org() RETURNS trigger AS $$
DECLARE role_org text; user_org text;
BEGIN
  SELECT "organizationId" INTO role_org FROM "Role" WHERE id = NEW."A";
  SELECT "organizationId" INTO user_org FROM "User" WHERE id = NEW."B";
  IF role_org IS NOT NULL AND user_org IS NOT NULL AND role_org <> user_org THEN
    RAISE EXCEPTION 'Cross-tenant role assignment rejected' USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_roles_same_org ON "_UserRoles";
CREATE TRIGGER user_roles_same_org BEFORE INSERT OR UPDATE ON "_UserRoles"
  FOR EACH ROW EXECUTE FUNCTION enforce_user_role_same_org();

ALTER TABLE "_UserRoles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_UserRoles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "_UserRoles";
CREATE POLICY tenant_isolation ON "_UserRoles"
  USING (EXISTS (SELECT 1 FROM "Role" r
                  WHERE r.id = "_UserRoles"."A"
                    AND r."organizationId" = current_setting('app.org_id', true)));
