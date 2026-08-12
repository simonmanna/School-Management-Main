import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import type {
  CreateRoleInput,
  CreateUserInput,
  PermissionCatalog,
  ResetPasswordInput,
  Role,
  UpdateRoleInput,
  UpdateUserInput,
  UserList,
  UserSummary,
} from './types';

// ============================================================================
// Permission catalog
// ============================================================================

export function usePermissionCatalog() {
  return useQuery({
    queryKey: ['staff', 'permissions'],
    queryFn: async () => (await api.get<PermissionCatalog>('/auth/permissions')).data,
    staleTime: 5 * 60_000,
  });
}

// ============================================================================
// Roles
// ============================================================================

export function useRoles() {
  return useQuery({
    queryKey: ['staff', 'roles'],
    queryFn: async () => (await api.get<Role[]>('/roles')).data,
  });
}

export function useRole(id: string | undefined) {
  return useQuery({
    queryKey: ['staff', 'roles', id],
    enabled: !!id,
    queryFn: async () => (await api.get<Role>(`/roles/${id}`)).data,
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRoleInput) =>
      (await api.post<Role>('/roles', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', 'roles'] });
      notify.success('Role created');
    },
    onError: (e: any) =>
      notify.error('Failed to create role', e?.response?.data?.message ?? e.message),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateRoleInput }) =>
      (await api.patch<Role>(`/roles/${id}`, input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', 'roles'] });
      notify.success('Role updated');
    },
    onError: (e: any) =>
      notify.error('Failed to update role', e?.response?.data?.message ?? e.message),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/roles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', 'roles'] });
      notify.success('Role deleted');
    },
    onError: (e: any) =>
      notify.error('Failed to delete role', e?.response?.data?.message ?? e.message),
  });
}

// ============================================================================
// Users
// ============================================================================

export interface UserListParams {
  page: number;
  pageSize: number;
  search?: string;
}

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: ['staff', 'users', params],
    queryFn: async () => (await api.get<UserList>('/users', { params })).data,
  });
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: ['staff', 'users', id],
    enabled: !!id,
    queryFn: async () => (await api.get<UserSummary>(`/users/${id}`)).data,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateUserInput) =>
      (await api.post<UserSummary>('/users', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', 'users'] });
      notify.success('User created');
    },
    onError: (e: any) =>
      notify.error('Failed to create user', e?.response?.data?.message ?? e.message),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateUserInput }) =>
      (await api.patch<UserSummary>(`/users/${id}`, input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', 'users'] });
      notify.success('User updated');
    },
    onError: (e: any) =>
      notify.error('Failed to update user', e?.response?.data?.message ?? e.message),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', 'users'] });
      notify.success('User deleted');
    },
    onError: (e: any) =>
      notify.error('Failed to delete user', e?.response?.data?.message ?? e.message),
  });
}

export function useResetUserPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: ResetPasswordInput }) =>
      api.post(`/users/${id}/reset-password`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', 'users'] });
      notify.success('Password reset — all sessions revoked');
    },
    onError: (e: any) =>
      notify.error('Failed to reset password', e?.response?.data?.message ?? e.message),
  });
}

export function useUnlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<UserSummary>(`/users/${id}/unlock`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', 'users'] });
      notify.success('Account unlocked');
    },
    onError: (e: any) =>
      notify.error('Failed to unlock account', e?.response?.data?.message ?? e.message),
  });
}
