import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import { TaskCard } from './task-card';
import type { Task } from '../types';
import type { ColumnDef } from './column-config';

interface KanbanColumnProps {
  column: ColumnDef;
  tasks: Task[];
  onTaskClick: (taskId: string) => void;
}

export function KanbanColumn({ column, tasks, onTaskClick }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-lg bg-muted/30 p-3 transition-colors',
        isOver && 'bg-muted/50 ring-2 ring-primary/20',
      )}
    >
      {/* Column header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: column.dotColor }}
          />
          <h3 className="text-sm font-semibold">{column.title}</h3>
        </div>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">
          {tasks.length}
        </span>
      </div>

      {/* Task list */}
      <SortableContext
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className="flex flex-col gap-2 overflow-y-auto min-h-[60px]"
          style={{ maxHeight: 'calc(100vh - 260px)' }}
        >
          {tasks.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground/50">
              Drop tasks here
            </div>
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => onTaskClick(task.id)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}
