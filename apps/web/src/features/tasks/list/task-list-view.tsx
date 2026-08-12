import { useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Eye, Plus } from 'lucide-react';
import { useTasks } from '../api';
import { useTaskStore } from '../task.store';
import { PRIORITY_COLORS, PRIORITY_LABELS, CATEGORY_LABELS } from '../kanban/column-config';
import type { Task, TaskFilters } from '../types';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  ASSIGNED: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  WAITING: 'bg-purple-100 text-purple-700',
  REVIEW: 'bg-orange-100 text-orange-700',
  VERIFIED: 'bg-teal-100 text-teal-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-red-100 text-red-700',
  SKIPPED: 'bg-gray-100 text-gray-700',
  OVERDUE: 'bg-red-200 text-red-800',
};

export function TaskListView() {
  const navigate = useNavigate();
  const { filters, setFilters, openDrawer } = useTaskStore();

  const queryFilters: TaskFilters = {
    ...(filters.status.length ? { status: filters.status.join(',') } : {}),
    ...(filters.priority.length ? { priority: filters.priority.join(',') } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
    ...(filters.search ? { search: filters.search } : {}),
    page: 1,
    limit: 100,
  };

  const { data, isLoading } = useTasks(queryFilters);

  const columns: Column<Task>[] = [
    {
      key: 'title',
      header: 'Task',
      className: 'min-w-[200px]',
      render: (row) => (
        <div>
          <div className="font-medium">{row.title}</div>
          {row.description && (
            <div className="text-xs text-muted-foreground line-clamp-1">{row.description}</div>
          )}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (row) => row.category ? CATEGORY_LABELS[row.category] ?? row.category : '-',
    },
    {
      key: 'branch',
      header: 'Branch',
      render: (row) => row.branch?.name ?? '-',
    },
    {
      key: 'area',
      header: 'Area',
      render: (row) => row.area ?? '-',
    },
    {
      key: 'assignedTo',
      header: 'Assigned To',
      render: (row) =>
        row.assignedTo ? `${row.assignedTo.firstName} ${row.assignedTo.lastName ?? ''}`.trim() : '-',
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (row) => (
        <Badge
          variant="outline"
          className="text-xs"
          style={{
            backgroundColor: `${PRIORITY_COLORS[row.priority] ?? '#94a3b8'}20`,
            color: PRIORITY_COLORS[row.priority] ?? '#94a3b8',
            borderColor: `${PRIORITY_COLORS[row.priority] ?? '#94a3b8'}40`,
          }}
        >
          {PRIORITY_LABELS[row.priority] ?? row.priority}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge className={`text-xs ${STATUS_COLORS[row.status] ?? ''}`}>
          {row.status.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      key: 'dueDate',
      header: 'Due Date',
      render: (row) =>
        row.dueDate
          ? new Date(row.dueDate).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })
          : '-',
    },
    {
      key: 'checklistProgress',
      header: 'Progress',
      render: (row) =>
        row.checklistTotal > 0 ? `${row.checklistProgress}%` : '-',
    },
    {
      key: 'updatedAt',
      header: 'Last Updated',
      render: (row) => new Date(row.updatedAt).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-16',
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            openDrawer(row.id);
          }}
        >
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search tasks..."
          className="h-8 w-48"
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
        />
        <Select
          value={filters.priority[0] ?? ''}
          onValueChange={(v) => setFilters({ priority: v ? [v] : [] })}
        >
          <SelectTrigger className="h-8 w-32">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Priorities</SelectItem>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.category}
          onValueChange={(v) => setFilters({ category: v })}
        >
          <SelectTrigger className="h-8 w-36">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Categories</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button size="sm" onClick={() => navigate('/tasks/new')}>
          <Plus className="mr-1 h-4 w-4" /> New Task
        </Button>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        loading={isLoading}
        getRowId={(row) => row.id}
        compact
        cellClassName="cursor-pointer"
      />

      {/* Pagination info */}
      {data && (
        <div className="text-xs text-muted-foreground">
          {data.total} task{data.total !== 1 ? 's' : ''} found
        </div>
      )}
    </div>
  );
}
