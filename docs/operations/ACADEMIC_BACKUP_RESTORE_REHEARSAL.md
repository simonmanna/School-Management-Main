# Academic Backup and Restore Rehearsal

Run this quarterly and before every academic schema cutover. A successful `pg_dump` is not
evidence of recoverability; only a restore plus data checks is.

## Preconditions

- Use staging or an isolated restoration host, never the production database name.
- Record operator, source snapshot timestamp, git SHA, PostgreSQL version and ticket id.
- Store the dump on separate media and record its SHA-256 checksum.
- Provision secrets through the environment/secret store; never paste them into the ticket.

## Procedure

1. Put the source into a consistent backup window and run the configured full backup.
2. Verify the dump catalogue with `pg_restore --list` and record the SHA-256 checksum.
3. Create a new empty database whose name ends `_restore_rehearsal`.
4. Restore with `--no-owner --no-privileges --exit-on-error`.
5. Point a one-off API container at the restored database and run Prisma migration status.
6. Run `01_academic_preflight.sql`, `02_academic_reconciliation.sql`, API health checks and
   `pnpm test:academics` against the restored instance.
7. Select one published ResultSet. Recalculate its output checksum without publishing and
   verify the stored report card can be reproduced.
8. Record elapsed restore time (RTO), newest recoverable transaction (RPO), row counts,
   checksums and every exception.
9. Destroy the isolated database only after the evidence has been reviewed.

## Pass criteria

- Restore completes without ignored errors.
- Dump checksum matches the source artefact.
- No tenant, mark, roster or published-result reconciliation difference is unexplained.
- One report is reproduced from its frozen inputs.
- Measured RTO is at most four hours and measured RPO is within the configured target.

## Evidence record

| Field | Value |
|---|---|
| Rehearsal ticket | |
| Operator / reviewer | |
| Source snapshot UTC | |
| Git SHA / schema migration | |
| Dump SHA-256 | |
| Restore started / completed UTC | |
| Measured RTO / RPO | |
| Preflight output attachment | |
| Reconciliation output attachment | |
| Result/report checksum | |
| Exceptions and owner | |
| Approved | |
