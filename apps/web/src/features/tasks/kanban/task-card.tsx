import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Clock, MessageSquare, Paperclip, RotateCcw, User, CheckSquare } from 'lucide-react';
import type { Task } from '../types';
import {
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  TASK_TYPE_ICONS,
} from './column-config';

interface TaskCardProps {
  task: Task;
  onClick?: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const priorityColor = PRIORITY_COLORS[task.priority] ?? '#94a3b8';
  const isOverdue = task.status !== 'COMPLETED' && task.status !== 'CANCELLED' &&
    task.dueDate && new Date(task.dueDate) < new Date();

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        'group rounded-lg border bg-card p-3 shadow-sm transition-all hover:shadow-md cursor-pointer',
        isDragging && 'opacity-50 shadow-lg',
        isOverdue && 'border-red-300',
      )}
    >
      {/* Priority strip */}
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg" style={{ backgroundColor: priorityColor }} />

      <div className="space-y-2">
        {/* Row 1: Type icon + Title */}
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-sm">{TASK_TYPE_ICONS[task.taskType] ?? '📌'}</span>
          <h4 className="flex-1 text-sm font-medium leading-tight line-clamp-2">
            {task.title}
          </h4>
          <Badge
            variant="outline"
            className="shrink-0 text-[10px] px-1.5 py-0 h-5"
            style={{
              backgroundColor: `${priorityColor}15`,
              color: priorityColor,
              borderColor: `${priorityColor}30`,
            }}
          >
            {PRIORITY_LABELS[task.priority] ?? task.priority}
          </Badge>
        </div>

        {/* Row 2: Assignee + Due Date */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            {task.assignedTo ? (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                <span className="truncate max-w-[80px]">
                  {task.assignedTo.firstName}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground/50">Unassigned</span>
            )}
          </div>
          {task.dueDate && (
            <span className={cn('flex items-center gap-1', isOverdue && 'text-red-500 font-medium')}>
              <Clock className="h-3 w-3" />
              {new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              {task.dueTime && ` ${task.dueTime}`}
            </span>
          )}
        </div>

        {/* Row 3: Labels */}
        {task.labels && task.labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {task.labels.slice(0, 3).map((label) => (
              <span
                key={label.id}
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: label.color }}
                title={label.name}
              />
            ))}
            {task.labels.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{task.labels.length - 3}</span>
            )}
          </div>
        )}

        {/* Row 4: Meta icons */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {task.checklistTotal > 0 && (
            <span className="flex items-center gap-1">
              <CheckSquare className="h-3 w-3" />
              {task.checklistProgress}%
            </span>
          )}
          {task.isRecurring && (
            <span className="flex items-center gap-1">
              <RotateCcw className="h-3 w-3" />
            </span>
          )}
          {task.attachmentUrls && task.attachmentUrls.length > 0 && (
            <span className="flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              {task.attachmentUrls.length}
            </span>
          )}
          {task.photoUrls && task.photoUrls.length > 0 && (
            <span className="flex items-center gap-1">📷 {task.photoUrls.length}</span>
          )}
          {task.comments && task.comments.length > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {task.comments.length}
            </span>
          )}
          {task.estimatedMinutes && (
            <span className="flex items-center gap-1">⏱ {task.estimatedMinutes}m</span>
          )}
        </div>

        {/* Progress bar */}
        {task.checklistTotal > 0 && (
          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${task.checklistProgress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
