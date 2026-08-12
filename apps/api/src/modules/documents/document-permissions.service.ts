/**
 * Granular document permissions (rev 2 review §4, Phase 1.4):
 * `doc:<type>:<action>` → `doc:<category>:<action>` → `doc:<action>`.
 *
 * Key format follows the codebase colon convention (dms-architecture §4):
 *   document:sales_invoice:post        (exact type)
 *   document:retail:post               (category fallback)
 *   document:post                      (generic — only where defined)
 *
 * Backend enforcement happens in lifecycle guards + controllers (Phase 2);
 * this service is the single resolution point for both sides.
 */
import { Injectable } from '@nestjs/common';

export interface PermissionSubject {
  code: string;
  category: string;
  security?: { basePermission?: string; visibility?: 'doc' | 'branch' | 'org' } | null;
}

/**
 * Normalize a registry row (Prisma JsonValue `security` column) into the
 * resolution subject. Registry JSON is validated at seed time, so a plain
 * cast is safe here.
 */
export function toPermissionSubject(row: {
  code: string;
  category: string;
  security?: unknown;
}): PermissionSubject {
  return {
    code: row.code,
    category: row.category,
    security: (row.security as PermissionSubject['security']) ?? null,
  };
}

@Injectable()
export class DocumentPermissionsService {
  /**
   * Resolve the effective permission key for (subject, action) against the
   * user's granted keys. Returns null when the user has no grant.
   */
  resolveKey(userKeys: string[], subject: PermissionSubject | null, action: string): string | null {
    const base = subject?.security?.basePermission ?? 'document';
    if (subject) {
      const exact = `${base}:${subject.code}:${action}`;
      if (userKeys.includes(exact)) return exact;
      const category = `${base}:${subject.category}:${action}`;
      if (userKeys.includes(category)) return category;
    }
    const generic = `${base}:${action}`;
    return userKeys.includes(generic) ? generic : null;
  }

  can(userKeys: string[], subject: PermissionSubject | null, action: string): boolean {
    return this.resolveKey(userKeys, subject, action) !== null;
  }
}