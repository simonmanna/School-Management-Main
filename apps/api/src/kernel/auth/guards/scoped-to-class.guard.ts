import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataScopeService } from '../data-scope.service';

export const SCOPED_CLASS_FIELD_KEY = 'scopedClassField';

/**
 * Enforces "you may only act on a class you may touch".
 *
 * Mirrors ScopedToStudentGuard exactly, including fail-closed behaviour on a
 * missing field and all-or-nothing handling of comma-separated id lists (a
 * caller appending a stranger's class id to their own is refused). The actual
 * scope decision lives in DataScopeService.assertMayTouchClass — this guard is
 * only the request plumbing.
 */
@Injectable()
export class ScopedToClassGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataScope: DataScopeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const field = this.reflector.get<string>(SCOPED_CLASS_FIELD_KEY, context.getHandler());
    if (!field) return true; // not configured on this handler

    const request = context.switchToHttp().getRequest();
    // Reads name the class in the query string (?classId=), writes in the
    // params or body — all three are checked (Wave 5, teacher read scoping).
    const raw: unknown = request.params?.[field] ?? request.query?.[field] ?? request.body?.[field];

    if (typeof raw !== 'string' && !Array.isArray(raw)) {
      throw new ForbiddenException('No class was named for a class-scoped route');
    }

    const ids = (Array.isArray(raw) ? raw : raw.split(',')).map((s) => String(s).trim()).filter(Boolean);
    if (ids.length === 0) {
      throw new ForbiddenException('No class was named for a class-scoped route');
    }

    for (const id of ids) {
      await this.dataScope.assertMayTouchClass(id);
    }
    return true;
  }
}
