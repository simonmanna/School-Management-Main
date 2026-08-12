import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  Task, TaskDashboard, TaskLabel, TaskRecurringTemplate, TaskAutoRule,
  PaginatedTasks, TaskFilters, TaskComment,
} from './types';

const TASKS_KEY = 'tasks';

// ─── Queries ─────────────────────────────────────────────────────────

export function useTasks(filters?: TaskFilters) {
  const params: Record<string, string | number | undefined> = {};
  if (filters) {
    Object.entries(filters).forEach(([key, val]) => {
      if (val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0)) {
        params[key] = val;
      }
    });
  }
  return useQuery<PaginatedTasks>({
    queryKey: [TASKS_KEY, params],
    queryFn: async () => (await api.get<PaginatedTasks>('/tasks', { params })).data,
  });
}

export function useTask(id: string | null) {
  return useQuery<Task>({
    queryKey: [TASKS_KEY, id],
    queryFn: async () => (await api.get<Task>(`/tasks/${id}`)).data,
    enabled: !!id,
  });
}

export function useTaskDashboard() {
  return useQuery<TaskDashboard>({
    queryKey: [TASKS_KEY, 'dashboard'],
    queryFn: async () => (await api.get<TaskDashboard>('/tasks/dashboard')).data,
    refetchInterval: 30_000, // refresh every 30s
  });
}

export function useTaskLabels() {
  return useQuery<TaskLabel[]>({
    queryKey: [TASKS_KEY, 'labels'],
    queryFn: async () => (await api.get<TaskLabel[]>('/tasks/labels')).data,
  });
}

export function useTaskTemplates() {
  return useQuery<TaskRecurringTemplate[]>({
    queryKey: [TASKS_KEY, 'templates'],
    queryFn: async () => (await api.get<TaskRecurringTemplate[]>('/tasks/templates')).data,
  });
}

export function useTaskAutoRules() {
  return useQuery<TaskAutoRule[]>({
    queryKey: [TASKS_KEY, 'auto-rules'],
    queryFn: async () => (await api.get<TaskAutoRule[]>('/tasks/auto-rules')).data,
  });
}

// ─── Mutations ───────────────────────────────────────────────────────

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<Task>) => (await api.post<Task>('/tasks', data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TASKS_KEY] });
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<Task> & { id: string }) =>
      (await api.patch<Task>(`/tasks/${id}`, data)).data,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: [TASKS_KEY] });
      qc.setQueryData([TASKS_KEY, result.id], result);
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/tasks/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TASKS_KEY] });
    },
  });
}

export function useReorderTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      (await api.patch<Task>(`/tasks/${id}/reorder`, { status })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TASKS_KEY] });
    },
  });
}

export function useToggleChecklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, itemId, isCompleted }: { taskId: string; itemId: string; isCompleted: boolean }) =>
      (await api.patch<Task>(`/tasks/${taskId}/checklist/${itemId}`, { isCompleted })).data,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: [TASKS_KEY] });
      qc.setQueryData([TASKS_KEY, result.id], result);
    },
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, ...data }: { taskId: string; content: string; parentId?: string; mentions?: string[]; attachmentUrls?: string[] }) =>
      (await api.post<TaskComment>(`/tasks/${taskId}/comments`, data)).data,
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: [TASKS_KEY, vars.taskId] });
    },
  });
}

export function useVerifyTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; verificationMethod: string; verificationNote?: string }) =>
      (await api.post<Task>(`/tasks/${id}/verify`, data)).data,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: [TASKS_KEY] });
      qc.setQueryData([TASKS_KEY, result.id], result);
    },
  });
}

export function useCreateLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; color?: string }) =>
      (await api.post<TaskLabel>('/tasks/labels', data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TASKS_KEY, 'labels'] });
    },
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<TaskRecurringTemplate>) =>
      (await api.post<TaskRecurringTemplate>('/tasks/templates', data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TASKS_KEY, 'templates'] });
    },
  });
}

export function useCreateAutoRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<TaskAutoRule>) =>
      (await api.post<TaskAutoRule>('/tasks/auto-rules', data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TASKS_KEY, 'auto-rules'] });
    },
  });
}
