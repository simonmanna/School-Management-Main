import { TaskStatus } from '../types';

export interface ColumnDef {
  id: string;
  title: string;
  color: string;
  dotColor: string;
  statuses: TaskStatus[];
  icon?: string;
}

export const COLUMNS: ColumnDef[] = [
  {
    id: 'todo',
    title: 'To Do',
    color: 'bg-slate-400',
    dotColor: '#94a3b8',
    statuses: [TaskStatus.DRAFT, TaskStatus.PENDING],
  },
  {
    id: 'assigned',
    title: 'Assigned',
    color: 'bg-blue-500',
    dotColor: '#3b82f6',
    statuses: [TaskStatus.ASSIGNED],
  },
  {
    id: 'in_progress',
    title: 'In Progress',
    color: 'bg-amber-500',
    dotColor: '#f59e0b',
    statuses: [TaskStatus.IN_PROGRESS],
  },
  {
    id: 'waiting',
    title: 'Waiting',
    color: 'bg-purple-500',
    dotColor: '#a855f7',
    statuses: [TaskStatus.WAITING],
  },
  {
    id: 'review',
    title: 'Review',
    color: 'bg-orange-500',
    dotColor: '#f97316',
    statuses: [TaskStatus.REVIEW],
  },
  {
    id: 'verified',
    title: 'Verified',
    color: 'bg-teal-500',
    dotColor: '#14b8a6',
    statuses: [TaskStatus.VERIFIED],
  },
  {
    id: 'completed',
    title: 'Completed',
    color: 'bg-emerald-500',
    dotColor: '#10b981',
    statuses: [TaskStatus.COMPLETED],
  },
  {
    id: 'cancelled',
    title: 'Cancelled',
    color: 'bg-red-400',
    dotColor: '#f87171',
    statuses: [TaskStatus.CANCELLED, TaskStatus.SKIPPED],
  },
  {
    id: 'overdue',
    title: 'Overdue',
    color: 'bg-red-600',
    dotColor: '#dc2626',
    statuses: [], // computed — tasks with dueDate < now and not completed/cancelled
  },
];

export function getColumnForStatus(status: TaskStatus): ColumnDef {
  return COLUMNS.find((c) => c.statuses.includes(status)) ?? COLUMNS[0];
}

export function getStatusesForColumn(columnId: string): TaskStatus[] {
  const col = COLUMNS.find((c) => c.id === columnId);
  return col?.statuses ?? [];
}

export function getColumnColor(status: TaskStatus): string {
  return getColumnForStatus(status).dotColor;
}

export const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#22c55e',
  OPTIONAL: '#94a3b8',
};

export const PRIORITY_LABELS: Record<string, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  OPTIONAL: 'Optional',
};

export const TASK_TYPE_ICONS: Record<string, string> = {
  OPENING: '🔓',
  CLOSING: '🔒',
  CLEANING: '🧹',
  MAINTENANCE: '🔧',
  INVENTORY: '📦',
  AUDIT: '📋',
  PURCHASE: '🛒',
  INCIDENT: '⚠️',
  COMPLIANCE: '✓',
  FOOD_SAFETY: '🥗',
  EQUIPMENT_INSPECTION: '🔍',
  SHIFT: '🔄',
  RECURRING: '🔁',
  ONE_TIME: '📌',
  CUSTOM: '⚡',
};

export const CATEGORY_LABELS: Record<string, string> = {
  OPENING: 'Opening',
  CLOSING: 'Closing',
  CLEANING: 'Cleaning',
  KITCHEN: 'Kitchen',
  COFFEE_BAR: 'Coffee Bar',
  DINING_AREA: 'Dining Area',
  RETAIL_FLOOR: 'Retail Floor',
  WAREHOUSE: 'Warehouse',
  INVENTORY: 'Inventory',
  PURCHASING: 'Purchasing',
  ACCOUNTING: 'Accounting',
  CASH_MANAGEMENT: 'Cash',
  SECURITY: 'Security',
  MAINTENANCE: 'Maintenance',
  EQUIPMENT: 'Equipment',
  MARKETING: 'Marketing',
  COMPLIANCE: 'Compliance',
  AUDIT: 'Audit',
  CUSTOMER_SERVICE: 'Customer Service',
  CUSTOM: 'Custom',
};
