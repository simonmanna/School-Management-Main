import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Calendar,
  Clock,
  User,
  Building2,
  CheckSquare,
  MessageSquare,
  History,
  Paperclip,
  RotateCcw,
  AlertTriangle,
  MapPin,
  Layers,
} from 'lucide-react';
import { useTask } from '../api';
import {
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  TASK_TYPE_ICONS,
  CATEGORY_LABELS,
} from '../kanban/column-config';
import type { TaskComment } from '../types';

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

interface TaskDrawerProps {
  taskId: string | null;
  open: boolean;
  onClose: () => void;
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div>
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="font-medium">{value ?? '-'}</div>
      </div>
    </div>
  );
}

export function TaskDrawer({ taskId, open, onClose }: TaskDrawerProps) {
  const { data: task, isLoading } = useTask(taskId);

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {task && (
              <>
                <span className="text-lg">{TASK_TYPE_ICONS[task.taskType] ?? '📌'}</span>
                <Badge className={`text-xs ${STATUS_COLORS[task.status] ?? ''}`}>
                  {task.status.replace('_', ' ')}
                </Badge>
                <Badge
                  variant="outline"
                  className="text-xs"
                  style={{
                    backgroundColor: `${PRIORITY_COLORS[task.priority] ?? '#94a3b8'}20`,
                    color: PRIORITY_COLORS[task.priority] ?? '#94a3b8',
                    borderColor: `${PRIORITY_COLORS[task.priority] ?? '#94a3b8'}40`,
                  }}
                >
                  {PRIORITY_LABELS[task.priority] ?? task.priority}
                </Badge>
              </>
            )}
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4 p-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : task ? (
          <div className="space-y-6">
            <div>
              <DialogTitle className="text-xl">{task.title}</DialogTitle>
              {task.description && (
                <DialogDescription className="mt-2 whitespace-pre-wrap text-sm">
                  {task.description}
                </DialogDescription>
              )}
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              <InfoRow icon={<User className="h-4 w-4" />} label="Assigned To" value={task.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName ?? ''}`.trim() : 'Unassigned'} />
              <InfoRow icon={<User className="h-4 w-4" />} label="Supervisor" value={task.supervisor ? `${task.supervisor.firstName} ${task.supervisor.lastName ?? ''}`.trim() : 'None'} />
              <InfoRow icon={<Building2 className="h-4 w-4" />} label="Branch" value={task.branch?.name ?? '-'} />
              <InfoRow icon={<MapPin className="h-4 w-4" />} label="Area" value={task.area ?? '-'} />
              <InfoRow icon={<Layers className="h-4 w-4" />} label="Category" value={task.category ? CATEGORY_LABELS[task.category] ?? task.category : '-'} />
              <InfoRow icon={<Calendar className="h-4 w-4" />} label="Due Date" value={task.dueDate ? `${new Date(task.dueDate).toLocaleDateString()}${task.dueTime ? ` ${task.dueTime}` : ''}` : '-'} />
              <InfoRow icon={<Clock className="h-4 w-4" />} label="Est. Duration" value={task.estimatedMinutes ? `${task.estimatedMinutes} min` : '-'} />
              {task.actualMinutes && <InfoRow icon={<Clock className="h-4 w-4" />} label="Actual Duration" value={`${task.actualMinutes} min`} />}
              {task.isRecurring && (
                <InfoRow icon={<RotateCcw className="h-4 w-4" />} label="Recurrence" value={task.recurrenceType ?? 'Yes'} />
              )}
            </div>

            <Separator />

            {task.checklistItems && task.checklistItems.length > 0 && (
              <div>
                <h4 className="flex items-center gap-2 text-sm font-semibold mb-2">
                  <CheckSquare className="h-4 w-4" />
                  Checklist ({task.checklistProgress}%)
                </h4>
                <div className="space-y-1">
                  {task.checklistItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={item.isCompleted}
                        readOnly
                        className="h-3.5 w-3.5 rounded border-gray-300"
                      />
                      <span className={item.isCompleted ? 'line-through text-muted-foreground' : ''}>
                        {item.description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(task.attachmentUrls?.length > 0 || task.photoUrls?.length > 0) && (
              <div>
                <h4 className="flex items-center gap-2 text-sm font-semibold mb-2">
                  <Paperclip className="h-4 w-4" />
                  Attachments ({task.attachmentUrls.length + task.photoUrls.length})
                </h4>
              </div>
            )}

            <Separator />

            {task.comments && task.comments.length > 0 && (
              <div>
                <h4 className="flex items-center gap-2 text-sm font-semibold mb-2">
                  <MessageSquare className="h-4 w-4" />
                  Comments ({task.comments.length})
                </h4>
                <div className="space-y-3">
                  {task.comments.map((comment) => (
                    <CommentBubble key={comment.id} comment={comment} />
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {task.activityLog && task.activityLog.length > 0 && (
              <div>
                <h4 className="flex items-center gap-2 text-sm font-semibold mb-2">
                  <History className="h-4 w-4" />
                  Activity
                </h4>
                <div className="space-y-2 text-xs text-muted-foreground">
                  {task.activityLog.slice(0, 10).map((log) => (
                    <div key={log.id} className="flex gap-2">
                      <span className="text-nowrap">
                        {new Date(log.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span>{log.description ?? log.action}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {task.requiresVerification && (
              <div>
                <h4 className="flex items-center gap-2 text-sm font-semibold mb-2 text-amber-600">
                  <AlertTriangle className="h-4 w-4" />
                  Verification Required
                </h4>
                <div className="text-sm text-muted-foreground">
                  {task.verifiedAt
                    ? `Verified on ${new Date(task.verifiedAt).toLocaleDateString()}`
                    : 'Pending verification'}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            Task not found
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CommentBubble({ comment }: { comment: TaskComment }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground mb-1">
        User · {new Date(comment.createdAt).toLocaleDateString()}
      </div>
      <div className="text-sm">{comment.content}</div>
      {comment.replies && comment.replies.length > 0 && (
        <div className="ml-4 mt-2 space-y-2 border-l-2 pl-3">
          {comment.replies.map((reply) => (
            <CommentBubble key={reply.id} comment={reply} />
          ))}
        </div>
      )}
    </div>
  );
}
