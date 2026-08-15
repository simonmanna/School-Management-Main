-- A0: drop the enteredById → StaffProfile foreign key on GradeEntry.
--
-- `enteredById` records the ACTOR (an auth User) who entered the marks — the
-- same identity kind as the FK-less `approvedById`. The column, however,
-- carried a StaffProfile FK, so a User id could never satisfy it and every
-- insert with a known actor failed the constraint. The column becomes a plain
-- actor-id string, symmetric with `approvedById`.

-- DropForeignKey
ALTER TABLE "GradeEntry" DROP CONSTRAINT IF EXISTS "GradeEntry_enteredById_fkey";
