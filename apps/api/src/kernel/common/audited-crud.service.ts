import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from './base-crud.service';
import { SOFT_DELETE } from '../prisma/tenancy.extension';

/**
 * CRUD with an audit trail and referential guards (ADR-006, brief §40 / §41).
 *
 * `BaseCrudService` gives generic list/find/create/update/remove and turns a
 * P2002 into a 409. That is right for most catalogs, and it is deliberately NOT
 * changed here: roughly forty services across accounting, HR and POS extend it,
 * and widening its contract would change all of them at once.
 *
 * Academic structure needs two things it does not provide:
 *
 *  1. **Audit.** Renaming "P4 North" to "P4 East" silently rewrites what every
 *     historical class list appears to say. Who did it, when, and what it was
 *     before are not optional. Audit rows are written with `recordInTx` inside
 *     the same transaction as the business write, so an audit failure rolls the
 *     change back rather than leaving an unexplained edit.
 *  2. **Delete guards.** A class or stream that carries historical enrollment
 *     cannot be deleted without destroying the reports that depend on it. The
 *     replacement is `isActive = false`: rows stay queryable, and only pickers
 *     filter them out.
 *
 * Subclasses override `assertDeletable` and `assertWritable`. Both receive the
 * transaction client, so their checks and the write are atomic — a count taken
 * outside the transaction can be stale by the time the delete lands.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export abstract class AuditedCrudService<T = any, CreateInput = any, UpdateInput = any>
  extends BaseCrudService<T, CreateInput, UpdateInput> {
  protected constructor(
    delegate: CrudDelegate,
    protected readonly prisma: PrismaService,
    protected readonly audit: AuditService,
  ) {
    super(delegate);
  }

  /**
   * The Prisma delegate reached through a transaction client. `entityName`
   * mirrors the model name for every service that extends this, so the lookup is
   * by convention rather than configuration.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected txDelegate(tx: any): CrudDelegate {
    const key = this.entityName.charAt(0).toLowerCase() + this.entityName.slice(1);
    const delegate = tx[key];
    if (!delegate) {
      throw new Error(
        `${this.entityName} has no Prisma delegate named "${key}". ` +
          'AuditedCrudService resolves the delegate from entityName; override txDelegate() ' +
          'if this service is named differently from its model.',
      );
    }
    return delegate as CrudDelegate;
  }

  /**
   * Reject a write that is structurally invalid. Runs before create and update.
   * `id` is null on create. Default: everything is allowed.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  protected async assertWritable(_tx: any, _id: string | null, _data: unknown): Promise<void> {
    // Subclasses override.
  }

  /**
   * Reject a delete that would destroy history. Throw `ConflictException` naming
   * what blocks it and what to do instead. Default: everything is deletable.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  protected async assertDeletable(_tx: any, _id: string): Promise<void> {
    // Subclasses override.
  }

  /** Values recorded in the audit row. Override to redact or trim noisy fields. */
  protected auditSnapshot(row: unknown): unknown {
    return row;
  }

  async create(data: CreateInput): Promise<T> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await this.prisma.client.$transaction(async (tx: any) => {
        await this.assertWritable(tx, null, data);
        const created = await this.txDelegate(tx).create({
          data,
          include: this.defaultInclude,
        });
        await this.audit.recordInTx(tx, {
          entity: this.entityName,
          entityId: created.id,
          action: 'create',
          newValues: this.auditSnapshot(created),
        });
        return created;
      })) as T;
    } catch (err) {
      throw this.asHttpError(err, `${this.entityName} with these details already exists`);
    }
  }

  async update(id: string, data: UpdateInput): Promise<T> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await this.prisma.client.$transaction(async (tx: any) => {
        const delegate = this.txDelegate(tx);
        const before = await delegate.findFirst({ where: { id } });
        if (!before) throw new NotFoundException(`${this.entityName} ${id} not found`);

        await this.assertWritable(tx, id, data);

        // updateMany, not update: the tenancy extension injects organizationId
        // into the `where` of a many-write, which a by-id update cannot carry.
        // That is what keeps a single-record write tenant-safe.
        const res = await delegate.updateMany({ where: { id }, data });
        if (res.count === 0) throw new NotFoundException(`${this.entityName} ${id} not found`);

        const after = await delegate.findFirst({ where: { id }, include: this.defaultInclude });
        await this.audit.recordInTx(tx, {
          entity: this.entityName,
          entityId: id,
          action: 'update',
          oldValues: this.auditSnapshot(before),
          newValues: this.auditSnapshot(after),
        });
        return after;
      })) as T;
    } catch (err) {
      throw this.asHttpError(err, `${this.entityName} update conflicts with an existing record`);
    }
  }

  async remove(id: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.prisma.client.$transaction(async (tx: any) => {
      const delegate = this.txDelegate(tx);
      const before = await delegate.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`${this.entityName} ${id} not found`);

      await this.assertDeletable(tx, id);

      if (SOFT_DELETE.has(this.entityName)) {
        const res = await delegate.updateMany({ where: { id }, data: { deletedAt: new Date() } });
        if (res.count === 0) throw new NotFoundException(`${this.entityName} ${id} not found`);
      } else {
        const res = await delegate.deleteMany({ where: { id } });
        if (res.count === 0) throw new NotFoundException(`${this.entityName} ${id} not found`);
      }

      await this.audit.recordInTx(tx, {
        entity: this.entityName,
        entityId: id,
        action: 'delete',
        oldValues: this.auditSnapshot(before),
      });
    });
  }

  /**
   * Count rows that would be orphaned by removing this one, so a guard can
   * report every blocker at once. Being told "it has enrollments", fixing that,
   * and then being told "it has timetable slots" is three round trips to learn
   * one thing.
   */
  protected async countBlockers(
    checks: Array<{ label: string; count: () => Promise<number> }>,
  ): Promise<Array<{ label: string; n: number }>> {
    const results = await Promise.all(
      checks.map(async (c) => ({ label: c.label, n: await c.count() })),
    );
    return results.filter((r) => r.n > 0);
  }

  /** Standard refusal for a delete that would destroy history. */
  protected blockedByHistory(blockers: Array<{ label: string; n: number }>): ConflictException {
    const detail = blockers.map((b) => `${b.n} ${b.label}`).join(', ');
    return new ConflictException(
      `This ${this.entityName} cannot be deleted because it still has ${detail}. ` +
        'Historical records must stay queryable, so deactivate it instead ' +
        '(set isActive to false) — it will disappear from pickers while past ' +
        'class lists, report cards and fee statements keep working.',
    );
  }

  /** Preserve BaseCrudService's P2002 to 409 mapping, and pass through Nest errors. */
  private asHttpError(err: unknown, conflictMessage: string): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException(conflictMessage);
    }
    return err;
  }
}
