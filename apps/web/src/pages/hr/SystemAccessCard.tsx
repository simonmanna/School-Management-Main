import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Link2, Link2Off, Loader2, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { useAuthStore } from '@/stores/auth.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface OrgUser { id: string; email: string; firstName: string; lastName: string | null; isActive: boolean }
interface OrgRole { id: string; name: string }

/**
 * "Give system access" for a staff member (E2E audit T1).
 *
 * Everything a teacher does as themselves — their register, their marks, their
 * payslip — resolves the login to an HrEmployee through `HrEmployee.userId`.
 * The API had `POST /hr/employees/:id/link-user` but no screen called it, so no
 * teacher could ever act as themselves. This card links an existing login, or
 * invites a new one (the invite email carries a set-password link) and links it.
 */
export function SystemAccessCard({
  employeeId,
  userId,
  email,
  firstName,
  lastName,
}: {
  employeeId: string;
  userId: string | null;
  email: string | null;
  firstName: string;
  lastName: string | null;
}) {
  const qc = useQueryClient();
  const perms = useAuthStore((s) => s.permissions);
  const canLink = perms.includes('hr:employee_identity');
  const canInvite = perms.includes('user:create');
  const [mode, setMode] = useState<'idle' | 'existing' | 'invite'>('idle');
  const [pick, setPick] = useState('');
  const [inviteEmail, setInviteEmail] = useState(email ?? '');
  const [roleId, setRoleId] = useState('');

  const users = useQuery({
    queryKey: ['organization-users'],
    enabled: canLink,
    queryFn: async () => {
      const res = (await api.get<{ data?: OrgUser[] } | OrgUser[]>('/users', { params: { pageSize: 200 } })).data;
      return Array.isArray(res) ? res : (res.data ?? []);
    },
  });
  const roles = useQuery({
    queryKey: ['roles', 'list'],
    enabled: mode === 'invite',
    queryFn: async () => {
      const res = (await api.get<{ data?: OrgRole[] } | OrgRole[]>('/roles')).data;
      return Array.isArray(res) ? res : (res.data ?? []);
    },
  });
  const linked = users.data?.find((u) => u.id === userId);

  const link = useMutation({
    mutationFn: async (uid: string | null) =>
      (await api.post(`/hr/employees/${employeeId}/link-user`, { userId: uid })).data,
    onSuccess: (_d, uid) => {
      qc.invalidateQueries({ queryKey: ['hr'] });
      notify.success(uid ? 'Login linked — they can now act as themselves.' : 'Login unlinked.');
      setMode('idle');
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Could not link the login'),
  });

  const invite = useMutation({
    mutationFn: async () => {
      const created = (
        await api.post<OrgUser>('/users/invite', {
          email: inviteEmail.trim(),
          firstName,
          lastName: lastName ?? undefined,
          roleIds: roleId ? [roleId] : [],
        })
      ).data;
      await api.post(`/hr/employees/${employeeId}/link-user`, { userId: created.id });
      return created;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr'] });
      qc.invalidateQueries({ queryKey: ['organization-users'] });
      notify.success('Invitation sent and linked', { description: `${inviteEmail} will get a link to set a password.` });
      setMode('idle');
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Could not invite this person'),
  });

  if (!canLink) return null;
  const busy = link.isPending || invite.isPending;
  const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

  return (
    <Card>
      <CardHeader className="bg-muted/30 border-b rounded-t-lg">
        <CardTitle className="flex items-center gap-2 text-sm"><KeyRound className="h-4 w-4" /> System access</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 text-sm">
        {userId ? (
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-medium">{linked ? `${linked.firstName} ${linked.lastName ?? ''}`.trim() : 'Linked login'}</div>
              <div className="text-xs text-muted-foreground">
                {linked?.email ?? userId}
                {linked && !linked.isActive && ' · invitation not yet accepted'}
              </div>
            </div>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => link.mutate(null)}>
              <Link2Off className="mr-1 h-3.5 w-3.5" /> Unlink
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">
            No login is linked, so this person cannot take their own register, enter their marks or see their payslip.
          </p>
        )}

        {!userId && mode === 'idle' && (
          <div className="flex flex-wrap gap-2">
            {canInvite && (
              <Button size="sm" onClick={() => setMode('invite')}>
                <UserPlus className="mr-1 h-3.5 w-3.5" /> Give system access
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setMode('existing')}>
              <Link2 className="mr-1 h-3.5 w-3.5" /> Link an existing login
            </Button>
          </div>
        )}

        {mode === 'existing' && (
          <div className="space-y-2">
            <select className={sel} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a login…</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>{`${u.firstName} ${u.lastName ?? ''}`.trim()} · {u.email}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button size="sm" disabled={!pick || busy} onClick={() => link.mutate(pick)}>Link</Button>
              <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>Cancel</Button>
            </div>
          </div>
        )}

        {mode === 'invite' && (
          <div className="space-y-2">
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@school.ug" />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <select className={sel} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                <option value="">Choose a role…</option>
                {(roles.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={!inviteEmail.includes('@') || !roleId || busy} onClick={() => invite.mutate()}>
                {invite.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Send invitation
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
