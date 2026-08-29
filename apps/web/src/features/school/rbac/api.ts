import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import type {
  CreateSchoolRoleInput,
  PermissionCatalog,
  SchoolRole,
  UpdateSchoolRoleInput,
} from './types';

/** GET /auth/permissions — the grouped permission catalog (gated on role:read). */
export function usePermissionCatalog() {
  return useQuery({
    queryKey: ['school', 'rbac', 'permission-catalog'],
    queryFn: async () => (await api.get<PermissionCatalog>('/auth/permissions')).data,
    staleTime: 5 * 60_000,
  });
}

/** GET /roles — every role in the org (gated on role:read). */
export function useRoles() {
  return useQuery({
    queryKey: ['school', 'rbac', 'roles'],
    queryFn: async () => (await api.get<SchoolRole[]>('/roles')).data,
  });
}

/** GET /roles/:id — single role (gated on role:read). */
export function useRole(id: string | undefined) {
  return useQuery({
    queryKey: ['school', 'rbac', 'roles', id],
    enabled: !!id,
    queryFn: async () => (await api.get<SchoolRole>(`/roles/${id}`)).data,
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSchoolRoleInput) =>
      (await api.post<SchoolRole>('/roles', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'rbac', 'roles'] });
      notify.success('Role created');
    },
    onError: (e: any) => notify.error('Failed to create role', e?.response?.data?.message ?? e.message),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateSchoolRoleInput }) =>
      (await api.patch<SchoolRole>(`/roles/${id}`, input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'rbac', 'roles'] });
      notify.success('Role updated');
    },
    onError: (e: any) => notify.error('Failed to update role', e?.response?.data?.message ?? e.message),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/roles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school', 'rbac', 'roles'] });
      notify.success('Role deleted');
    },
    onError: (e: any) => notify.error('Failed to delete role', e?.response?.data?.message ?? e.message),
  });
}
