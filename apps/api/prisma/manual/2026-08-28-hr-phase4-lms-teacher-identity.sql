-- HR Phase 4: repair LmsRoleAssignment rows that carry a StaffProfile.id in
-- `userId`.
--
-- `LmsRoleAssignment.userId` must be a platform `User.id` — the capability
-- guard builds its principal from `tenant.userId`. Roster sync wrote
-- `CourseOfferingTeacher.teacherPartnerId` (a `StaffProfile.id`) instead, so
-- every auto-granted `editingteacher` role pointed at an id no principal could
-- match. Teachers were locked out of their own courses and only got in through
-- the coarse-permission fallback in `CapabilityService.fromPermissions()`.
--
-- The code fix resolves StaffProfile → Partner → HrEmployee → User before
-- assigning. This repairs the rows already written.

-- Rewrite rows whose userId is actually a StaffProfile id, where that person's
-- login can be resolved through the Partner bridge.
UPDATE "LmsRoleAssignment" ra
SET "userId" = m."userId"
FROM (
  SELECT sp."id" AS "staffProfileId", sp."organizationId", e."userId"
  FROM "StaffProfile" sp
  JOIN "HrEmployee" e
    ON e."partnerId" = sp."partnerId"
   AND e."organizationId" = sp."organizationId"
   AND e."deletedAt" IS NULL
  WHERE sp."deletedAt" IS NULL
    AND e."userId" IS NOT NULL
) m
WHERE ra."userId" = m."staffProfileId"
  AND ra."organizationId" = m."organizationId"
  -- only touch rows that are definitely wrong: the id is NOT a real User
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = ra."userId")
  -- and do not create a duplicate assignment for the same context+role
  AND NOT EXISTS (
    SELECT 1 FROM "LmsRoleAssignment" x
    WHERE x."organizationId" = ra."organizationId"
      AND x."contextId" = ra."contextId"
      AND x."roleId" = ra."roleId"
      AND x."userId" = m."userId"
      AND x."id" <> ra."id"
  );

-- Anything still pointing at a non-User id is unrepairable (no linked login).
-- Delete rather than leave a role assignment that can never match a principal
-- and would keep masking a real permission problem. Re-running roster sync
-- recreates it correctly once the login is linked.
DELETE FROM "LmsRoleAssignment" ra
WHERE ra."userId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = ra."userId");
