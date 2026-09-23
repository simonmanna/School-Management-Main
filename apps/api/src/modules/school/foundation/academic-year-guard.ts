import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * What a write intends to do to an academic year's records.
 *
 *   create   — new enrollments, placements, cohorts, terms, offerings.
 *   modify   — any other change to an existing record (status, move, dates).
 *   complete — closing out the year's own memberships (COMPLETED / graduation),
 *              which a promotion run legitimately does after the year is CLOSED.
 */
export type YearWriteIntent = 'create' | 'modify' | 'complete';

/**
 * Refuse writes against a CLOSED or ARCHIVED academic year (brief §3: "closed
 * years cannot accidentally receive new records").
 *
 * Takes a `FOR SHARE` lock on the year row inside the caller's transaction, so
 * it serializes with `AcademicYearService.setStatus`, which locks the same row
 * `FOR UPDATE` before closing it: an enrollment and a closure racing each other
 * cannot both commit. Outside a transaction the lock is a no-op and the check
 * still applies.
 *
 * Raw SQL bypasses the tenancy extension, so the organization is filtered here
 * explicitly.
 */
export async function assertYearWritable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  organizationId: string,
  academicYearId: string,
  intent: YearWriteIntent = 'modify',
): Promise<{ id: string; name: string; status: string }> {
  const rows: Array<{ id: string; name: string; status: string }> = await tx.$queryRaw`
    SELECT "id", "name", "status"::text AS "status"
      FROM "AcademicYear"
     WHERE "id" = ${academicYearId}
       AND "organizationId" = ${organizationId}
       AND "deletedAt" IS NULL
       FOR SHARE`;
  const year = rows[0];
  if (!year) throw new NotFoundException(`Academic year ${academicYearId} not found`);

  if (year.status === 'ARCHIVED') {
    throw new BadRequestException(
      `"${year.name}" is archived. Its records are read-only and it cannot be re-opened.`,
    );
  }
  if (year.status === 'CLOSED' && intent !== 'complete') {
    throw new BadRequestException(
      `"${year.name}" is closed, so its records cannot be changed. ` +
        'Re-open the year (requires the academic-migration permission and a reason) to make a correction.',
    );
  }
  return year;
}
