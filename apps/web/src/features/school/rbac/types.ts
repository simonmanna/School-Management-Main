/**
 * Types for the School role & permission management UI.
 *
 * These intentionally mirror (and extend) the shared RBAC contract without
 * touching the staff RBAC feature: the `/roles` and `/auth/permissions`
 * endpoints are org-wide, but the School vertical surfaces `dataScope` on top
 * of the flat permission list.
 */

/** The "WHERE" dimension of a role — independent of the "WHAT" (permissions). */
export type RoleDataScope = 'own' | 'class' | 'department' | 'school';

export interface SchoolRole {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  /** Present on every role returned by the API (defaults to 'school'). */
  dataScope?: RoleDataScope | null;
  createdAt: string;
  updatedAt: string;
  /** Only present on GET /roles/:id and in the list payload from the service. */
  _count?: { users: number };
}

export interface CatalogPermission {
  key: string;
  label: string;
  description: string;
  risk?: 'high';
}

export interface CatalogSubgroup {
  subgroup: string;
  permissions: CatalogPermission[];
}

export interface CatalogGroup {
  group: string;
  subgroups: CatalogSubgroup[];
}

/** Shape returned by GET /auth/permissions (buildPermissionCatalog). */
export interface PermissionCatalog {
  groups: CatalogGroup[];
}

export interface CreateSchoolRoleInput {
  name: string;
  description?: string;
  permissions: string[];
  dataScope?: RoleDataScope;
  isSystem?: boolean;
}

export interface UpdateSchoolRoleInput {
  name?: string;
  description?: string;
  permissions?: string[];
  dataScope?: RoleDataScope;
}

/** Human labels for the data-scope selector (the "WHERE" dimension). */
export const DATA_SCOPES: { value: RoleDataScope; label: string; description: string }[] = [
  {
    value: 'own',
    label: 'Own',
    description: 'Only records the user owns or is directly responsible for.',
  },
  {
    value: 'class',
    label: 'Class',
    description: 'Records within the user’s assigned class(es).',
  },
  {
    value: 'department',
    label: 'Department',
    description: 'Records across the user’s department.',
  },
  {
    value: 'school',
    label: 'School',
    description: 'All records across the entire school (widest scope).',
  },
];

export function dataScopeLabel(scope?: RoleDataScope | null): string {
  return DATA_SCOPES.find((s) => s.value === scope)?.label ?? 'School';
}
