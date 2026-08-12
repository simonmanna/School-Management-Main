export enum TaskType {
  ONE_TIME = 'ONE_TIME',
  RECURRING = 'RECURRING',
  SHIFT = 'SHIFT',
  OPENING = 'OPENING',
  CLOSING = 'CLOSING',
  CLEANING = 'CLEANING',
  MAINTENANCE = 'MAINTENANCE',
  INVENTORY = 'INVENTORY',
  AUDIT = 'AUDIT',
  PURCHASE = 'PURCHASE',
  INCIDENT = 'INCIDENT',
  COMPLIANCE = 'COMPLIANCE',
  FOOD_SAFETY = 'FOOD_SAFETY',
  EQUIPMENT_INSPECTION = 'EQUIPMENT_INSPECTION',
  CUSTOM = 'CUSTOM',
}

export enum TaskPriority {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  OPTIONAL = 'OPTIONAL',
}

export enum TaskStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING = 'WAITING',
  REVIEW = 'REVIEW',
  VERIFIED = 'VERIFIED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  SKIPPED = 'SKIPPED',
  OVERDUE = 'OVERDUE',
}

export enum TaskCategory {
  OPENING = 'OPENING',
  CLOSING = 'CLOSING',
  CLEANING = 'CLEANING',
  KITCHEN = 'KITCHEN',
  COFFEE_BAR = 'COFFEE_BAR',
  DINING_AREA = 'DINING_AREA',
  RETAIL_FLOOR = 'RETAIL_FLOOR',
  WAREHOUSE = 'WAREHOUSE',
  INVENTORY = 'INVENTORY',
  PURCHASING = 'PURCHASING',
  ACCOUNTING = 'ACCOUNTING',
  CASH_MANAGEMENT = 'CASH_MANAGEMENT',
  SECURITY = 'SECURITY',
  MAINTENANCE = 'MAINTENANCE',
  EQUIPMENT = 'EQUIPMENT',
  MARKETING = 'MARKETING',
  COMPLIANCE = 'COMPLIANCE',
  AUDIT = 'AUDIT',
  CUSTOMER_SERVICE = 'CUSTOMER_SERVICE',
  CUSTOM = 'CUSTOM',
}

export enum TaskArea {
  KITCHEN = 'KITCHEN',
  COFFEE_STATION = 'COFFEE_STATION',
  BAR = 'BAR',
  DINING_AREA = 'DINING_AREA',
  RETAIL_FLOOR = 'RETAIL_FLOOR',
  WAREHOUSE = 'WAREHOUSE',
  OFFICE = 'OFFICE',
  CASHIER = 'CASHIER',
  STORAGE = 'STORAGE',
  DELIVERY = 'DELIVERY',
  RESTROOM = 'RESTROOM',
  PARKING = 'PARKING',
  OTHER = 'OTHER',
}

export enum RecurrenceType {
  HOURLY = 'HOURLY',
  EVERY_X_HOURS = 'EVERY_X_HOURS',
  DAILY = 'DAILY',
  WEEKDAYS = 'WEEKDAYS',
  WEEKENDS = 'WEEKENDS',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
  CUSTOM_DATES = 'CUSTOM_DATES',
  SPECIFIC_SHIFT = 'SPECIFIC_SHIFT',
  AFTER_COMPLETION = 'AFTER_COMPLETION',
}

export interface TaskLabel {
  id: string;
  name: string;
  color: string;
}

export interface TaskChecklistItem {
  id: string;
  taskId: string;
  description: string;
  isCompleted: boolean;
  completedAt: string | null;
  completedBy: string | null;
  sortOrder: number;
}

export interface TaskComment {
  id: string;
  taskId: string;
  parentId: string | null;
  content: string;
  mentions: string[];
  attachmentUrls: string[];
  emojiReactions: Record<string, string[]> | null;
  createdById: string;
  createdAt: string;
  replies?: TaskComment[];
}

export interface TaskActivityLog {
  id: string;
  taskId: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  description: string | null;
  createdById: string;
  createdAt: string;
}

export interface TaskUser {
  id: string;
  firstName: string;
  lastName: string | null;
  email?: string;
}

export interface TaskBranch {
  id: string;
  name: string;
}

export interface Task {
  id: string;
  organizationId: string;
  branchId: string | null;
  title: string;
  description: string | null;
  taskType: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  category: TaskCategory | null;
  area: TaskArea | null;
  departmentId: string | null;
  assignedToId: string | null;
  assignedRole: string | null;
  supervisorId: string | null;
  dueDate: string | null;
  dueTime: string | null;
  startTime: string | null;
  completedAt: string | null;
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  isRecurring: boolean;
  recurrenceType: RecurrenceType | null;
  recurrenceConfig: Record<string, unknown> | null;
  parentTaskId: string | null;
  recurrenceOrder: number | null;
  requiresVerification: boolean;
  verificationMethod: string | null;
  verifiedById: string | null;
  verifiedAt: string | null;
  verificationPhoto: string | null;
  verificationNote: string | null;
  checklistProgress: number;
  checklistTotal: number;
  photoUrls: string[];
  attachmentUrls: string[];
  generatedByEvent: string | null;
  sourceReferenceId: string | null;
  sourceReferenceType: string | null;
  shiftId: string | null;
  createdAt: string;
  updatedAt: string;
  assignedTo: TaskUser | null;
  supervisor: TaskUser | null;
  verifiedBy: TaskUser | null;
  branch: TaskBranch | null;
  labels: TaskLabel[];
  checklistItems: TaskChecklistItem[];
  comments?: TaskComment[];
  activityLog?: TaskActivityLog[];
  children?: Task[];
}

export interface TaskDashboard {
  todayTotal: number;
  todayCompleted: number;
  pending: number;
  inProgress: number;
  overdue: number;
  dueToday: number;
  recurringToday: number;
  verificationPending: number;
  completionRate: number;
  avgCompletionMinutes: number;
  topEmployees: { assignedToId: string; completedCount: number }[];
}

export interface TaskRecurringTemplate {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  taskType: TaskType;
  taskCategory: TaskCategory | null;
  taskArea: TaskArea | null;
  priority: TaskPriority;
  recurrenceType: RecurrenceType;
  recurrenceConfig: Record<string, unknown> | null;
  estimatedMinutes: number | null;
  requiresVerification: boolean;
  verificationMethod: string | null;
  branchId: string | null;
  departmentId: string | null;
  assignToRole: string | null;
  assignToUserId: string | null;
  supervisorId: string | null;
  checklistTemplate: Array<{ description: string; sortOrder: number }> | null;
  isActive: boolean;
}

export interface TaskAutoRule {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  triggerEvent: string;
  triggerConfig: Record<string, unknown> | null;
  taskTitle: string;
  taskDescription: string | null;
  taskType: TaskType;
  taskCategory: TaskCategory | null;
  taskArea: TaskArea | null;
  taskPriority: TaskPriority;
  assignToRole: string | null;
  assignToUserId: string | null;
  branchId: string | null;
  requiresVerification: boolean;
  isActive: boolean;
}

export interface PaginatedTasks {
  items: Task[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TaskFilters {
  status?: string;
  priority?: string;
  category?: string;
  area?: string;
  branchId?: string;
  assignedToId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}
