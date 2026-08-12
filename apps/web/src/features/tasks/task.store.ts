import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type TaskViewMode = 'kanban' | 'list' | 'calendar' | 'dashboard';

export interface TaskFiltersState {
  status: string[];
  priority: string[];
  category: string;
  area: string;
  branchId: string;
  assignedToId: string;
  search: string;
  dateFrom: string;
  dateTo: string;
  view: TaskViewMode;
}

interface TaskStoreState {
  filters: TaskFiltersState;
  selectedTaskId: string | null;
  drawerOpen: boolean;
  offlineQueue: Array<{ action: string; payload: unknown; timestamp: number }>;
  setFilters: (filters: Partial<TaskFiltersState>) => void;
  resetFilters: () => void;
  openDrawer: (taskId: string) => void;
  closeDrawer: () => void;
  addToQueue: (action: string, payload: unknown) => void;
  clearQueue: () => void;
}

const defaultFilters: TaskFiltersState = {
  status: [],
  priority: [],
  category: '',
  area: '',
  branchId: '',
  assignedToId: '',
  search: '',
  dateFrom: '',
  dateTo: '',
  view: 'kanban',
};

export const useTaskStore = create<TaskStoreState>()(
  persist(
    (set) => ({
      filters: { ...defaultFilters },
      selectedTaskId: null,
      drawerOpen: false,
      offlineQueue: [],

      setFilters: (partial) =>
        set((state) => ({
          filters: { ...state.filters, ...partial },
        })),

      resetFilters: () =>
        set({ filters: { ...defaultFilters } }),

      openDrawer: (taskId) =>
        set({ selectedTaskId: taskId, drawerOpen: true }),

      closeDrawer: () =>
        set({ selectedTaskId: null, drawerOpen: false }),

      addToQueue: (action, payload) =>
        set((state) => ({
          offlineQueue: [
            ...state.offlineQueue,
            { action, payload, timestamp: Date.now() },
          ],
        })),

      clearQueue: () =>
        set({ offlineQueue: [] }),
    }),
    {
      name: 'cafe-pos-task-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        filters: state.filters,
      }),
    },
  ),
);
