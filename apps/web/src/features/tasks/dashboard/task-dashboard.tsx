import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ClipboardList,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calendar,
  RotateCcw,
  ShieldCheck,
  TrendingUp,
  Users,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { useTaskDashboard } from '../api';

interface KpiCardProps {
  title: string;
  value: number | string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  suffix?: string;
}

function KpiCard({ title, value, icon: Icon, color, bgColor, suffix }: KpiCardProps) {
  return (
    <Card className="border-l-4 rounded-lg" style={{ borderLeftColor: color }}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{title}</p>
            <p className="text-2xl font-bold" style={{ color }}>
              {value}{suffix ?? ''}
            </p>
          </div>
          <div className="rounded-full p-2" style={{ backgroundColor: bgColor }}>
            <Icon className="h-5 w-5" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TaskDashboard() {
  const { data: dash, isLoading } = useTaskDashboard();

  if (isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  if (!dash) return <div className="text-muted-foreground">No dashboard data</div>;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Today's Tasks" value={dash.todayTotal} icon={ClipboardList} color="#3b82f6" bgColor="#eff6ff" />
        <KpiCard title="Completed Today" value={dash.todayCompleted} icon={CheckCircle2} color="#10b981" bgColor="#ecfdf5" />
        <KpiCard title="Pending" value={dash.pending} icon={Clock} color="#f59e0b" bgColor="#fffbeb" />
        <KpiCard title="In Progress" value={dash.inProgress} icon={TrendingUp} color="#6366f1" bgColor="#eef2ff" />
        <KpiCard title="Overdue" value={dash.overdue} icon={AlertTriangle} color="#ef4444" bgColor="#fef2f2" />
        <KpiCard title="Due Today" value={dash.dueToday} icon={Calendar} color="#8b5cf6" bgColor="#f5f3ff" />
        <KpiCard title="Recurring Today" value={dash.recurringToday} icon={RotateCcw} color="#06b6d4" bgColor="#ecfeff" />
        <KpiCard title="Verification Pending" value={dash.verificationPending} icon={ShieldCheck} color="#f97316" bgColor="#fff7ed" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Completion Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-600">{dash.completionRate}%</div>
            <div className="mt-2 h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${dash.completionRate}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Timer className="h-4 w-4 text-blue-500" />
              Avg Completion Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">
              {dash.avgCompletionMinutes}m
            </div>
            <p className="text-xs text-muted-foreground mt-1">Minutes per task</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4 text-purple-500" />
              Top Employees
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dash.topEmployees.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data yet</p>
            ) : (
              <div className="space-y-2">
                {dash.topEmployees.slice(0, 5).map((emp, i) => (
                  <div key={emp.assignedToId} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">#{i + 1} Employee</span>
                    <span className="font-medium">{emp.completedCount} done</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
