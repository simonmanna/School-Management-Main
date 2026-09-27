import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { DataScopeService } from '../data-scope.service';
import { TenantContextService } from '../../tenancy/tenant-context.service';

export const PUPIL_SCOPE_EXEMPT_KEY = 'pupilScopeExempt';

/**
 * Opt a handler out of the pupil-scope guard. Needs a written reason at the call
 * site and an entry in docs/audit/authz-inventory.md — the default is scoped.
 */
export const PupilScopeExempt = (reason: string) => SetMetadata(PUPIL_SCOPE_EXEMPT_KEY, reason);

/** Request fields that name a pupil. */
const PUPIL_FIELDS = ['studentProfileId', 'studentId', 'studentProfileIds'] as const;

function collect(source: unknown, out: Set<string>): void {
  if (!source || typeof source !== 'object') return;
  for (const field of PUPIL_FIELDS) {
    const v = (source as Record<string, unknown>)[field];
    const values = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
    for (const raw of values) {
      const id = String(raw).trim();
      if (id) out.add(id);
    }
  }
}

/**
 * Audit 2026-09-27 F01/F02, invariant I-013: no pupil-keyed route interprets
 * teacher scope for itself.
 *
 * Any staff request that names a pupil — in the path, the query string or the
 * body — must name one the caller may read under `DataScopeService` (the same
 * seats the pupil list uses). A school-wide reader passes after one role lookup;
 * a class or subject teacher passes only for pupils seated in what they teach;
 * an account with no assignment passes for nobody.
 *
 * Portal (family/student) requests are governed by `@ScopedToStudent` instead
 * and pass through here. Permission checks still run first, in PermissionsGuard.
 */
@Injectable()
export class PupilScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly scope: DataScopeService,
    private readonly tenant: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<string>(PUPIL_SCOPE_EXEMPT_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest();
    if (!request.user || this.tenant.portal) return true;
    if (!this.tenant.optionalOrganizationId) return true;

    const ids = new Set<string>();
    collect(request.params, ids);
    collect(request.query, ids);
    collect(request.body, ids);
    if (ids.size === 0) return true;

    const visible = await this.scope.visibleStudentIds([...ids]);
    if (visible === 'all') return true;
    for (const id of ids) {
      if (!visible.has(id)) {
        throw new ForbiddenException('You may only work with the records of pupils in classes you teach');
      }
    }
    return true;
  }
}
