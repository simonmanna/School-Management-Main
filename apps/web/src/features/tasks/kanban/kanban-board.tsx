import { useCallback, useMemo } from 'react';
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { KanbanColumn } from './kanban-column';
import { COLUMNS } from './column-config';
import type { Task, TaskStatus } from '../types';

interface KanbanBoardProps {
  tasks: Task[];
  onReorder: (taskId: string, newStatus: string) => void;
  onTaskClick: (taskId: string) => void;
  loading?: boolean;
}

export function KanbanBoard({ tasks, onReorder, onTaskClick, loading }: KanbanBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columnTasks = useMemo(() => {
    const map = new Map<string, Task[]>();
    const now = new Date();

    for (const col of COLUMNS) {
      const colTasks = col.id === 'overdue'
        ? tasks.filter((t) =>
            t.dueDate && new Date(t.dueDate) < now &&
            t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && t.status !== 'SKIPPED')
        : tasks.filter((t) => col.statuses.includes(t.status as TaskStatus));
      map.set(col.id, colTasks);
    }
    return map;
  }, [tasks]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;

      const taskId = active.id as string;
      const targetCol = [...COLUMNS].reverse().find(
        (c) => c.id === over.id || c.statuses.some(() => columnTasks.get(c.id)?.some((t) => t.id === over.id)),
      );
      if (!targetCol || targetCol.id === 'overdue' || !targetCol.statuses[0]) return;

      const currentCol = COLUMNS.find((c) =>
        c.statuses.includes(tasks.find((t) => t.id === taskId)?.status as TaskStatus),
      );

      if (currentCol?.id !== targetCol.id) {
        onReorder(taskId, targetCol.statuses[0]);
      }
    },
    [tasks, onReorder, columnTasks],
  );

  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.filter((c) => c.id !== 'overdue').map((col) => (
          <div key={col.id} className="flex w-72 shrink-0 flex-col gap-2">
            <div className="h-8 w-24 animate-pulse rounded bg-muted" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            column={col}
            tasks={columnTasks.get(col.id) ?? []}
            onTaskClick={onTaskClick}
          />
        ))}
      </div>
    </DndContext>
  );
}
