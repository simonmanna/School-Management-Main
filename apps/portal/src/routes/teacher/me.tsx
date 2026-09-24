import { useNavigate } from 'react-router-dom';
import { Receipt, LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { serverLogout } from '@/lib/server-logout';
import { useMyPayslips } from '@/lib/portal-api';
import { formatCurrency } from '@/lib/utils';
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton, PageTitle, Badge } from '@/components/ui';

/**
 * Employee self-service.
 *
 * `hr/self/payslips` is gated on `hr:self`, which reads only the caller's OWN
 * record — deliberately not `hr:read`, which would show every colleague's pay.
 */
export default function TeacherMe() {
  const teacher = useAuthStore((s) => s.portal?.teacher);
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const navigate = useNavigate();
  const { data, isLoading } = useMyPayslips(!!teacher);

  return (
    <div className="space-y-4">
      <PageTitle sub={user?.email}>{teacher?.name ?? 'My account'}</PageTitle>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-4 w-4" /> Payslips
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {isLoading && <Skeleton className="h-16 w-full" />}
          {!isLoading && (data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No payslips available yet.</p>
          )}
          {(data ?? []).map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.periodLabel ?? 'Pay period'}</div>
                <div className="text-xs text-muted-foreground">
                  Net {formatCurrency(Number(p.netPay))}
                  {p.payDate && ` · ${new Date(p.payDate).toLocaleDateString()}`}
                </div>
              </div>
              <Badge variant={p.status === 'paid' ? 'success' : 'secondary'}>{p.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button
        variant="outline"
        size="lg"
        className="w-full"
        onClick={() => {
          serverLogout();
          clear();
          navigate('/login', { replace: true });
        }}
      >
        <LogOut className="h-5 w-5" /> Sign out
      </Button>
    </div>
  );
}
