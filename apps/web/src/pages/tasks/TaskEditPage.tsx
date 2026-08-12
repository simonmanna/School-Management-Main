import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ChevronRight, ArrowLeft, Save, Calendar, User,
  Package, Repeat,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateTask, useUpdateTask, useTask } from '@/features/tasks/api';
import { notify } from '@/lib/notify';
import {
  TaskType, TaskPriority, TaskStatus, TaskCategory, TaskArea
} from '@/features/tasks/types';

// Simple inline Checkbox component
function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
      {label}
    </label>
  );
}

const taskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  taskType: z.nativeEnum(TaskType).default(TaskType.ONE_TIME),
  priority: z.nativeEnum(TaskPriority).default(TaskPriority.MEDIUM),
  status: z.nativeEnum(TaskStatus).default(TaskStatus.DRAFT),
  category: z.nativeEnum(TaskCategory).optional().nullable(),
  area: z.nativeEnum(TaskArea).optional().nullable(),
  branchId: z.string().optional().nullable(),
  assignedToId: z.string().optional().nullable(),
  supervisorId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  dueTime: z.string().optional().nullable(),
  estimatedMinutes: z.number().optional().nullable(),
  isRecurring: z.boolean().default(false),
  requiresVerification: z.boolean().default(false),
  verificationMethod: z.string().optional().nullable(),
});

type TaskFormData = z.infer<typeof taskSchema>;

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  [TaskPriority.CRITICAL]: 'Critical',
  [TaskPriority.HIGH]: 'High',
  [TaskPriority.MEDIUM]: 'Medium',
  [TaskPriority.LOW]: 'Low',
  [TaskPriority.OPTIONAL]: 'Optional',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.DRAFT]: 'Draft',
  [TaskStatus.PENDING]: 'Pending',
  [TaskStatus.ASSIGNED]: 'Assigned',
  [TaskStatus.IN_PROGRESS]: 'In Progress',
  [TaskStatus.WAITING]: 'Waiting',
  [TaskStatus.REVIEW]: 'Review',
  [TaskStatus.VERIFIED]: 'Verified',
  [TaskStatus.COMPLETED]: 'Completed',
  [TaskStatus.CANCELLED]: 'Cancelled',
  [TaskStatus.SKIPPED]: 'Skipped',
  [TaskStatus.OVERDUE]: 'Overdue',
};

const TYPE_LABELS: Record<TaskType, string> = {
  [TaskType.ONE_TIME]: 'One-Time',
  [TaskType.RECURRING]: 'Recurring',
  [TaskType.SHIFT]: 'Shift',
  [TaskType.OPENING]: 'Opening',
  [TaskType.CLOSING]: 'Closing',
  [TaskType.CLEANING]: 'Cleaning',
  [TaskType.MAINTENANCE]: 'Maintenance',
  [TaskType.INVENTORY]: 'Inventory',
  [TaskType.AUDIT]: 'Audit',
  [TaskType.PURCHASE]: 'Purchase',
  [TaskType.INCIDENT]: 'Incident',
  [TaskType.COMPLIANCE]: 'Compliance',
  [TaskType.FOOD_SAFETY]: 'Food Safety',
  [TaskType.EQUIPMENT_INSPECTION]: 'Equipment Inspection',
  [TaskType.CUSTOM]: 'Custom',
};

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  [TaskCategory.OPENING]: 'Opening',
  [TaskCategory.CLOSING]: 'Closing',
  [TaskCategory.CLEANING]: 'Cleaning',
  [TaskCategory.KITCHEN]: 'Kitchen',
  [TaskCategory.COFFEE_BAR]: 'Coffee Bar',
  [TaskCategory.DINING_AREA]: 'Dining Area',
  [TaskCategory.RETAIL_FLOOR]: 'Retail Floor',
  [TaskCategory.WAREHOUSE]: 'Warehouse',
  [TaskCategory.INVENTORY]: 'Inventory',
  [TaskCategory.PURCHASING]: 'Purchasing',
  [TaskCategory.ACCOUNTING]: 'Accounting',
  [TaskCategory.CASH_MANAGEMENT]: 'Cash Management',
  [TaskCategory.SECURITY]: 'Security',
  [TaskCategory.MAINTENANCE]: 'Maintenance',
  [TaskCategory.EQUIPMENT]: 'Equipment',
  [TaskCategory.MARKETING]: 'Marketing',
  [TaskCategory.COMPLIANCE]: 'Compliance',
  [TaskCategory.AUDIT]: 'Audit',
  [TaskCategory.CUSTOMER_SERVICE]: 'Customer Service',
  [TaskCategory.CUSTOM]: 'Custom',
};

const AREA_LABELS: Record<TaskArea, string> = {
  [TaskArea.KITCHEN]: 'Kitchen',
  [TaskArea.COFFEE_STATION]: 'Coffee Station',
  [TaskArea.BAR]: 'Bar',
  [TaskArea.DINING_AREA]: 'Dining Area',
  [TaskArea.RETAIL_FLOOR]: 'Retail Floor',
  [TaskArea.WAREHOUSE]: 'Warehouse',
  [TaskArea.OFFICE]: 'Office',
  [TaskArea.CASHIER]: 'Cashier',
  [TaskArea.STORAGE]: 'Storage',
  [TaskArea.DELIVERY]: 'Delivery',
  [TaskArea.RESTROOM]: 'Restroom',
  [TaskArea.PARKING]: 'Parking',
  [TaskArea.OTHER]: 'Other',
};

const TABS = [
  { id: 'general', label: 'General', icon: Package },
  { id: 'scheduling', label: 'Scheduling', icon: Calendar },
  { id: 'assignment', label: 'Assignment', icon: User },
  { id: 'recurrence', label: 'Recurrence', icon: Repeat },
] as const;

export function TaskEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = !id;

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: '',
      description: '',
      taskType: TaskType.ONE_TIME,
      priority: TaskPriority.MEDIUM,
      status: TaskStatus.DRAFT,
      category: null,
      area: null,
      branchId: '',
      assignedToId: '',
      supervisorId: '',
      dueDate: '',
      dueTime: '',
      estimatedMinutes: null,
      isRecurring: false,
      requiresVerification: false,
      verificationMethod: '',
    },
  });

  const [activeTab, setActiveTab] = useState('general');
  const [saving, setSaving] = useState(false);

  const { data: existingTask, isLoading: loadingTask } = useTask(id ?? null);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

  // Load existing task data
  useEffect(() => {
    if (!isNew && existingTask) {
      form.reset({
        title: existingTask.title,
        description: existingTask.description ?? '',
        taskType: existingTask.taskType,
        priority: existingTask.priority,
        status: existingTask.status,
        category: existingTask.category,
        area: existingTask.area,
        branchId: existingTask.branchId ?? '',
        assignedToId: existingTask.assignedToId ?? '',
        supervisorId: existingTask.supervisorId ?? '',
        dueDate: existingTask.dueDate ? existingTask.dueDate.split('T')[0] : '',
        dueTime: existingTask.dueTime ?? '',
        estimatedMinutes: existingTask.estimatedMinutes,
        isRecurring: existingTask.isRecurring,
        requiresVerification: existingTask.requiresVerification,
        verificationMethod: existingTask.verificationMethod ?? '',
      });
    }
  }, [existingTask, isNew, form]);

  const handleSelectChange = (field: any) => (value: string) => {
    // Convert empty string to null for optional nullable fields
    const finalValue = value === '' ? null : value;
    form.setValue(field, finalValue as any, { shouldValidate: true });
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    try {
      // Transform values for API (convert empty strings to null for optional UUID fields)
      const payload = {
        ...values,
        branchId: values.branchId || undefined,
        assignedToId: values.assignedToId || undefined,
        supervisorId: values.supervisorId || undefined,
        category: values.category || undefined,
        area: values.area || undefined,
        dueDate: values.dueDate || undefined,
        dueTime: values.dueTime || undefined,
        verificationMethod: values.verificationMethod || undefined,
      };

      if (isNew) {
        await createTask.mutateAsync(payload);
        notify.success('Task created');
      } else {
        await updateTask.mutateAsync({ id: id!, ...payload });
        notify.success('Task updated');
      }
      navigate('/tasks');
    } catch (err: any) {
      notify.error(err?.response?.data?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  });

  if (!isNew && loadingTask) {
    return (
      <div className="p-6 space-y-4 min-h-screen">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const title = isNew ? 'New Task' : existingTask?.title ?? 'Edit Task';
  const subtitle = isNew
    ? 'Fill in the details to create a new task.'
    : existingTask?.category ? `Category: ${CATEGORY_LABELS[existingTask.category]}` : 'Update task details below.';

  const priorityColor: Record<TaskPriority, string> = {
    [TaskPriority.CRITICAL]: 'bg-red-100 text-red-800',
    [TaskPriority.HIGH]: 'bg-orange-100 text-orange-800',
    [TaskPriority.MEDIUM]: 'bg-blue-100 text-blue-800',
    [TaskPriority.LOW]: 'bg-green-100 text-green-800',
    [TaskPriority.OPTIONAL]: 'bg-gray-100 text-gray-800',
  };

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb + Header */}
      <div className="px-6 py-4 border-b bg-white shadow-sm">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
          <button onClick={() => navigate('/tasks')} className="hover:text-primary transition-colors font-medium">
            Tasks
          </button>
          <ChevronRight className="h-3 w-3" />
          <span className="font-semibold">{isNew ? 'New Task' : existingTask?.title}</span>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/tasks')} className="h-8 w-8 flex-shrink-0 hover:bg-muted">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0"><Package className="h-5 w-5 text-primary" /></div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold">{title}</h1>
                {!isNew && existingTask && (
                  <>
                    <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-muted-foreground font-semibold">{existingTask.id.slice(0, 8)}</code>
                    <Badge variant={existingTask.isRecurring ? 'default' : 'secondary'} className="text-xs">
                      {existingTask.isRecurring ? 'Recurring' : 'One-Time'}
                    </Badge>
                  </>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => navigate('/tasks')}>
              Cancel
            </Button>
            <Button size="sm" onClick={onSubmit} disabled={saving}>
              <Save className="h-4 w-4 mr-1.5" />
              {saving ? 'Saving…' : 'Save Task'}
            </Button>
          </div>
        </div>
      </div>

      {/* Gradient tab bar */}
      <div className="px-2 py-1 bg-gradient-to-r from-primary to-indigo-600 shadow-lg sticky top-0 z-10 mx-2 mt-1 rounded-xl border border-white/10">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-transparent p-0 h-auto gap-2 rounded-none w-full justify-start border-none">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}
                className="relative px-4 py-2 rounded-lg text-sm font-medium text-white/80 hover:bg-white/15 hover:text-white transition-all duration-300 data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-lg data-[state=active]:font-bold data-[state=active]:scale-105"
              >
                <span className="flex items-center gap-2">
                  <tab.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Tab content */}
      <form onSubmit={onSubmit} className="flex-1 overflow-auto flex flex-col">
        <div className="flex-1 overflow-auto p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            {/* ── General Tab ── */}
            <TabsContent value="general" className="mt-0 outline-none space-y-6">
              <Card>
                <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Basic Information</CardTitle>
                </CardHeader>
                <CardContent className="px-5 py-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="title" className="text-sm font-medium">Title *</Label>
                      <Input id="title" {...form.register('title')} placeholder="Enter task title" />
                      {form.formState.errors.title && (
                        <p className="text-sm text-red-500">{form.formState.errors.title.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="taskType" className="text-sm font-medium">Task Type</Label>
                      <Select onValueChange={handleSelectChange('taskType')} defaultValue={form.watch('taskType')}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(TYPE_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="description" className="text-sm font-medium">Description</Label>
                    <Textarea id="description" {...form.register('description')} rows={3} placeholder="Task description (optional)" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="priority" className="text-sm font-medium">Priority</Label>
                      <Select onValueChange={handleSelectChange('priority')} defaultValue={form.watch('priority')}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select priority" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              <div className="flex items-center gap-2">
                                <Badge className={priorityColor[value as TaskPriority]} variant="outline">{label}</Badge>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="status" className="text-sm font-medium">Status</Label>
                      <Select onValueChange={handleSelectChange('status')} defaultValue={form.watch('status')}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(STATUS_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="category" className="text-sm font-medium">Category</Label>
                      <Select onValueChange={handleSelectChange('category')} defaultValue={(form.watch('category') as string | undefined) ?? ''}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="area" className="text-sm font-medium">Area</Label>
                      <Select onValueChange={handleSelectChange('area')} defaultValue={(form.watch('area') as string | undefined) ?? ''}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select area" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {Object.entries(AREA_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Scheduling Tab ── */}
            <TabsContent value="scheduling" className="mt-0 outline-none space-y-6">
              <Card>
                <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Due Date & Time</CardTitle>
                </CardHeader>
                <CardContent className="px-5 py-4 space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="dueDate" className="text-sm font-medium">Due Date</Label>
                      <Input id="dueDate" type="date" {...form.register('dueDate')} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="dueTime" className="text-sm font-medium">Due Time</Label>
                      <Input id="dueTime" type="time" {...form.register('dueTime')} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="estimatedMinutes" className="text-sm font-medium">Estimated Duration (minutes)</Label>
                      <Input id="estimatedMinutes" type="number" min="0" step="5" {...form.register('estimatedMinutes', { valueAsNumber: true })} placeholder="e.g., 30" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Verification</CardTitle>
                </CardHeader>
                <CardContent className="px-5 py-4 space-y-4">
                  <div className="flex items-center gap-4">
                    <Checkbox
                      label="Requires Verification"
                      checked={form.watch('requiresVerification')}
                      onChange={(checked) => form.setValue('requiresVerification', checked, { shouldValidate: true })}
                    />
                  </div>

                  {form.watch('requiresVerification') && (
                    <div className="space-y-1.5 ml-6">
                      <Label htmlFor="verificationMethod" className="text-sm font-medium">Verification Method</Label>
                      <Input id="verificationMethod" {...form.register('verificationMethod')} placeholder="e.g., Photo, Signature, QR Code" />
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Assignment Tab ── */}
            <TabsContent value="assignment" className="mt-0 outline-none space-y-6">
              <Card>
                <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Assignment</CardTitle>
                </CardHeader>
                <CardContent className="px-5 py-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="assignedToId" className="text-sm font-medium">Assigned To (User ID)</Label>
                      <Input id="assignedToId" {...form.register('assignedToId')} placeholder="User ID" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="supervisorId" className="text-sm font-medium">Supervisor (User ID)</Label>
                      <Input id="supervisorId" {...form.register('supervisorId')} placeholder="Supervisor User ID" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="branchId" className="text-sm font-medium">Branch ID</Label>
                    <Input id="branchId" {...form.register('branchId')} placeholder="Branch ID" />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Recurrence Tab ── */}
            <TabsContent value="recurrence" className="mt-0 outline-none space-y-6">
              <Card>
                <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Recurring Task Settings</CardTitle>
                </CardHeader>
                <CardContent className="px-5 py-4 space-y-4">
                  <div className="flex items-center gap-4">
                    <Checkbox
                      label="This is a recurring task"
                      checked={form.watch('isRecurring')}
                      onChange={(checked) => form.setValue('isRecurring', checked, { shouldValidate: true })}
                    />
                  </div>

                  {form.watch('isRecurring') && (
                    <div className="space-y-4 ml-6 border-l-2 border-muted pl-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="taskType" className="text-sm font-medium">Recurring Task Type</Label>
                          <Select onValueChange={handleSelectChange('taskType')} defaultValue={form.watch('taskType')}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={TaskType.RECURRING}>Recurring</SelectItem>
                              <SelectItem value={TaskType.SHIFT}>Shift</SelectItem>
                              <SelectItem value={TaskType.OPENING}>Opening</SelectItem>
                              <SelectItem value={TaskType.CLOSING}>Closing</SelectItem>
                              <SelectItem value={TaskType.CLEANING}>Cleaning</SelectItem>
                              <SelectItem value={TaskType.MAINTENANCE}>Maintenance</SelectItem>
                              <SelectItem value={TaskType.INVENTORY}>Inventory</SelectItem>
                              <SelectItem value={TaskType.AUDIT}>Audit</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </form>
    </div>
  );
}