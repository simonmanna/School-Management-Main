import { ConflictException } from '@nestjs/common';

/**
 * Optimistic-concurrency guard for academic mutable rows (marks, results,
 * quiz attempts, …).
 *
 * The academic domain has genuinely concurrent editors — two teachers on the
 * same marks sheet, a moderator and an enterer on the same student. A naive
 * `update({ where: { id } })` is a last-write-wins race that silently discards
 * one editor's work. Instead every mutable academic row carries a monotonic
 * `version Int @default(0)`, and edits go through this helper:
 *
 *   - the update matches on `{ id, version }`;
 *   - on success it bumps `version` by one;
 *   - if no row matched (someone else already advanced the version, or the row
 *     is gone) it throws `409 Conflict` carrying the *current* version so the
 *     caller can re-read and retry.
 *
 * This is the write-time half of the constraint-ownership table's
 * "optimistic concurrency (version guard)" row. It is deliberately tiny and
 * Prisma-model-agnostic: pass any delegate exposing `updateMany` / `findFirst`.
 */

export interface VersionedDelegate {
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  findFirst(args: { where: Record<string, unknown> }): Promise<{ version?: number } | null>;
}

export interface OptimisticUpdateOptions {
  /** Entity label used in the conflict message, e.g. 'GradeEntry'. */
  entity: string;
  /** Extra `where` predicates ANDed with `{ id, version }` (tenant scoping is applied by the Prisma extension). */
  where?: Record<string, unknown>;
}

/**
 * Apply `data` to the row `id` only if its `version` still equals `expectedVersion`.
 * Bumps `version` on success. Throws `ConflictException` (HTTP 409) on a version
 * mismatch or a missing row, including the row's current version when known.
 *
 * @returns the number of rows updated (always 1 on success).
 */
export async function optimisticUpdate(
  delegate: VersionedDelegate,
  id: string,
  expectedVersion: number,
  data: Record<string, unknown>,
  opts: OptimisticUpdateOptions,
): Promise<number> {
  const res = await delegate.updateMany({
    where: { id, version: expectedVersion, ...(opts.where ?? {}) },
    data: { ...data, version: { increment: 1 } },
  });
  if (res.count === 0) {
    const current = await delegate.findFirst({ where: { id } });
    if (!current) {
      throw new ConflictException(`${opts.entity} ${id} no longer exists`);
    }
    throw new ConflictException(
      `${opts.entity} ${id} was modified concurrently ` +
        `(expected version ${expectedVersion}, current ${current.version ?? 'unknown'}). Re-read and retry.`,
    );
  }
  return res.count;
}
