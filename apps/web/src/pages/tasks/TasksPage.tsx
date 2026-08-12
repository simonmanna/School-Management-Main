import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { KanbanBoard } from '@/features/tasks/kanban/kanban-board';
import { TaskListView } from '@/features/tasks/list/task-list-view';
import { TaskDashboard } from '@/features/tasks/dashboard/task-dashboard';
import { TaskDrawer } from '@/features/tasks/drawer/task-drawer';
import { TaskViewSwitcher } from '@/features/tasks/task-view-switcher';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useTasks, useReorderTask } from '@/features/tasks/api';
import { useTaskStore } from '@/features/tasks/task.store';

export function TasksPage() {
  const navigate = useNavigate();
  const { filters, selectedTaskId, drawerOpen, openDrawer, closeDrawer } = useTaskStore();
  const reorderTask = useReorderTask();
  const { data, isLoading } = useTasks();

  const handleReorder = useCallback(
    (taskId: string, newStatus: string) => {
      reorderTask.mutate({ id: taskId, status: newStatus });
    },
    [reorderTask],
  );

  const handleTaskClick = useCallback(
    (taskId: string) => {
      openDrawer(taskId);
    },
    [openDrawer],
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            Manage operational tasks across branches
          </p>
        </div>
        <Button onClick={() => navigate('/tasks/new')}>
          <Plus className="mr-1 h-4 w-4" /> New Task
        </Button>
      </div>

      {/* View switcher */}
      <TaskViewSwitcher />

      {/* Content */}
      <div className="mt-2">
        {filters.view === 'kanban' && (
          <KanbanBoard
            tasks={data?.items ?? []}
            onReorder={handleReorder}
            onTaskClick={handleTaskClick}
            loading={isLoading}
          />
        )}
        {filters.view === 'list' && <TaskListView />}
        {filters.view === 'dashboard' && <TaskDashboard />}
        {filters.view === 'calendar' && (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            Calendar view coming soon
          </div>
        )}
      </div>

      {/* Task detail drawer */}
      <TaskDrawer
        taskId={selectedTaskId}
        open={drawerOpen}
        onClose={closeDrawer}
      />
    </div>
  );
}
