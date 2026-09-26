import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, ClipboardList, FileBadge, Mail, UserPlus, Users, Ban } from 'lucide-react';
import {
  useClasses, useStudents, useStudentPortal, useTeacherPortal,
  useGuardians, usePortalAccounts, useInvitePortalAccount,
  useRevokePortalAccount, useBulkInviteGuardians,
  type BulkInviteOutcome,
} from '@/features/school/api';
import { useAuthStore } from '@/stores/auth.store';
import { PERMISSIONS } from '@erp/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolPortalsPage() {
  // Minting logins that can see a family's data is a different authority from
  // previewing what those logins see, so the tab follows the permission rather
  // than the page. The API enforces this too; hiding it just avoids offering a
  // registrar screen to someone who will only be refused.
  const canManageAccounts = useAuthStore((s) => s.hasPermission(PERMISSIONS.school.managePortalAccounts));

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Portals & Promotion Gate</h1>
        <p className="text-sm text-muted-foreground">Provision student, parent and teacher logins, preview what each of them sees, and run the promotion gate.</p>
      </div>
      <Tabs defaultValue={canManageAccounts ? 'accounts' : 'student'}>
        <TabsList>
          {canManageAccounts && <TabsTrigger value="accounts">Portal accounts</TabsTrigger>}
          <TabsTrigger value="student">Student / Parent</TabsTrigger>
          <TabsTrigger value="teacher">Teacher</TabsTrigger>
          <TabsTrigger value="rollover">Promotion & Rollover</TabsTrigger>
        </TabsList>
        {canManageAccounts && <TabsContent value="accounts" className="pt-4"><PortalAccountsTab/></TabsContent>}
        <TabsContent value="student" className="pt-4"><StudentPortalTab/></TabsContent>
        <TabsContent value="teacher" className="pt-4"><TeacherPortalTab/></TabsContent>
        <TabsContent value="rollover" className="pt-4"><RolloverTab/></TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Provisioning — the screen that gives families a way in.
 *
 * `POST school/portal-accounts/invite` shipped with the PortalIdentity migration
 * and had no caller anywhere in the app, so the portal had no users at all. An
 * invite creates an INACTIVE account with an unusable password: it becomes a
 * login only when the invitee follows their emailed link and chooses their own.
 * A registrar never handles, chooses or sees anybody's password.
 */
function PortalAccountsTab() {
  const { data: students } = useStudents({ pageSize: 200 });
  const [studentProfileId, setStudentProfileId] = useState('');
  const { data: guardians } = useGuardians(studentProfileId || undefined);
  const { data: accounts, isLoading } = usePortalAccounts(studentProfileId || undefined);
  const invite = useInvitePortalAccount();
  const revoke = useRevokePortalAccount();

  const student = (students?.data ?? []).find((s) => s.id === studentProfileId);
  const [pupilEmail, setPupilEmail] = useState('');

  const inviteGuardian = async (guardianContactId: string, email: string, firstName?: string, lastName?: string) => {
    try {
      const res = await invite.mutateAsync({ subjectType: 'guardian', guardianContactId, email, firstName, lastName });
      notify.success(res.inviteToken ? `Invite sent to ${email}` : `${email} is already linked — nothing sent`);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Invite failed');
    }
  };

  const invitePupil = async () => {
    try {
      const res = await invite.mutateAsync({ subjectType: 'student', studentProfileId, email: pupilEmail.trim() });
      notify.success(res.inviteToken ? `Invite sent to ${pupilEmail}` : 'Already linked — nothing sent');
      setPupilEmail('');
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Invite failed');
    }
  };

  return (
    <div className="space-y-4">
      <select className={sel + ' w-96'} value={studentProfileId} onChange={(e) => setStudentProfileId(e.target.value)}>
        <option value="">Student…</option>
        {(students?.data ?? []).map((s) => (
          <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>
        ))}
      </select>

      {studentProfileId && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Guardians on file</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(guardians ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No guardians recorded. Add one on the student profile first — an invite needs somebody to send to.
                </p>
              )}
              {(guardians ?? []).map((g) => {
                const name = [g.contact?.firstName, g.contact?.lastName].filter(Boolean).join(' ') || 'Guardian';
                const email = g.contact?.email?.trim();
                return (
                  <div key={g.id} className="flex items-center gap-2 rounded border p-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{name} <Badge variant="secondary">{g.relationship}</Badge></div>
                      <div className="truncate text-xs text-muted-foreground">{email ?? 'no email on file'}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!email || invite.isPending}
                      onClick={() => inviteGuardian(g.guardianContactId, email!, g.contact?.firstName, g.contact?.lastName ?? undefined)}
                    >
                      <Mail className="h-4 w-4" /> Invite
                    </Button>
                  </div>
                );
              })}

              <div className="pt-2">
                <div className="mb-1 text-xs font-medium text-muted-foreground">Invite the pupil themselves</div>
                <div className="flex gap-2">
                  <Input
                    className="h-9"
                    type="email"
                    placeholder={`${student?.partner?.name ?? 'pupil'}'s email`}
                    value={pupilEmail}
                    onChange={(e) => setPupilEmail(e.target.value)}
                  />
                  <Button size="sm" disabled={!pupilEmail.trim() || invite.isPending} onClick={invitePupil}>
                    <UserPlus className="h-4 w-4" /> Invite
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Portal logins for this pupil</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
              {!isLoading && (accounts ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No portal accounts yet.</p>
              )}
              {(accounts ?? []).map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded border p-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{a.user?.email ?? a.userId.slice(0, 8)}</div>
                    <div className="flex flex-wrap items-center gap-1 pt-1">
                      <Badge variant="outline">{a.subjectType}</Badge>
                      {a.revokedAt
                        ? <Badge variant="destructive">revoked</Badge>
                        : a.user?.isActive
                          ? <Badge>active</Badge>
                          /* Created but never accepted — the commonest support call
                             is "the email never arrived", so name that state. */
                          : <Badge variant="secondary">invited, not accepted</Badge>}
                      {a.user?.lastLoginAt && (
                        <span className="text-xs text-muted-foreground">
                          last in {new Date(a.user.lastLoginAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  {!a.revokedAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={revoke.isPending}
                      onClick={async () => {
                        try {
                          await revoke.mutateAsync({ portalIdentityId: a.id, studentProfileId });
                          notify.success('Access revoked');
                        } catch { notify.error('Revoke failed'); }
                      }}
                    >
                      <Ban className="h-4 w-4" /> Revoke
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <BulkInviteCard />
    </div>
  );
}

/** Term-start bulk action: invite every guardian in a class at once. */
function BulkInviteCard() {
  const { data: classes } = useClasses();
  const [classId, setClassId] = useState('');
  const bulk = useBulkInviteGuardians();
  const [outcomes, setOutcomes] = useState<BulkInviteOutcome[] | null>(null);

  const run = async () => {
    try {
      const res = await bulk.mutateAsync({ classId });
      setOutcomes(res);
      const sent = res.filter((r) => r.status === 'invited').length;
      const missing = res.filter((r) => r.status === 'no-email').length;
      notify.success(`${sent} invited${missing ? `, ${missing} have no email on file` : ''}`);
    } catch {
      notify.error('Bulk invite failed');
    }
  };

  const tone = (s: BulkInviteOutcome['status']) =>
    s === 'invited' ? 'default' : s === 'already-linked' ? 'secondary' : s === 'no-email' ? 'outline' : 'destructive';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" /> Invite a whole class</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <select className={sel + ' w-64'} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Class…</option>
            {(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Button size="sm" disabled={!classId || bulk.isPending} onClick={run}>
            {bulk.isPending ? 'Inviting…' : 'Invite all guardians'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          One invite per guardian on file. Guardians already linked are left alone; guardians with no
          email address are listed below rather than skipped quietly.
        </p>
        {outcomes && (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr><th className="px-2 py-1">Pupil</th><th className="px-2 py-1">Guardian</th><th className="px-2 py-1">Email</th><th className="px-2 py-1">Result</th></tr>
            </thead>
            <tbody>
              {outcomes.map((o, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-2 py-1">{o.studentName}</td>
                  <td className="px-2 py-1">{o.guardianName}</td>
                  <td className="px-2 py-1 text-muted-foreground">{o.email ?? '—'}</td>
                  <td className="px-2 py-1">
                    <Badge variant={tone(o.status)}>{o.status}</Badge>
                    {o.detail && <span className="pl-2 text-xs text-muted-foreground">{o.detail}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function StudentPortalTab() {
  const { data: students } = useStudents({ pageSize: 100 });
  const [id, setId] = useState('');
  const { data: p } = useStudentPortal(id || undefined);
  return (
    <div className="space-y-3">
      <select className={sel + ' w-80'} value={id} onChange={(e) => setId(e.target.value)}>
        <option value="">Student…</option>{(students?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>)}
      </select>
      {p && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader><CardTitle className="text-base">Published results</CardTitle></CardHeader>
            <CardContent>{p.publishedResults ? <div className="flex flex-wrap gap-2">
              <Badge>term {p.publishedResults.termId.slice(0,6)}</Badge>
              <Badge variant="secondary">mean {p.publishedResults.meanPercent != null ? Number(p.publishedResults.meanPercent) : '—'}%</Badge>
              <Badge variant="secondary">rank {p.publishedResults.classRank ?? '—'}</Badge>
              {p.publishedResults.promotionRecommendation && <Badge variant="outline">{p.publishedResults.promotionRecommendation}</Badge>}
            </div> : <p className="text-sm text-muted-foreground">No published result yet.</p>}</CardContent>
          </Card>
          <Card><CardHeader><CardTitle className="text-base">Certificates</CardTitle></CardHeader>
            <CardContent>{(p.certificates ?? []).map((c) => <div key={c.id} className="rounded border p-2 text-sm">{c.title} <Badge>{c.status}</Badge> {c.code && <span className="font-mono text-xs text-muted-foreground">{c.code.slice(0,8)}</span>}</div>)}
              {(p.certificates ?? []).length === 0 && <p className="text-sm text-muted-foreground">None issued.</p>}</CardContent>
          </Card>
          <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Assignments</CardTitle></CardHeader>
            <CardContent>{(p.assignments ?? []).map((a) => <div key={a.id} className="rounded border p-2 text-sm">{a.title} <Badge variant="secondary">{a.status}</Badge></div>)}
              {(p.assignments ?? []).length === 0 && <p className="text-sm text-muted-foreground">No assignments.</p>}</CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function TeacherPortalTab() {
  const [partnerId, setPartnerId] = useState('');
  const { data: p } = useTeacherPortal(partnerId || undefined);
  return (
    <div className="space-y-3">
      <Input className="w-80" placeholder="Teacher partner id" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} />
      {p && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><FileBadge className="h-4 w-4" /> Marking queue (spine)</CardTitle></CardHeader>
            <CardContent>{(p.markingQueue ?? []).map((m) => <div key={m.id} className="rounded border p-2 text-sm">{m.title} <Badge variant="destructive">{m.pending} pending</Badge></div>)}
              {(p.markingQueue ?? []).length === 0 && <p className="text-sm text-muted-foreground">Queue clear.</p>}</CardContent>
          </Card>
          <Card><CardHeader><CardTitle className="text-base">Classes</CardTitle></CardHeader>
            <CardContent>{(p.classes ?? []).map((c: any, i) => <div key={i} className="rounded border p-2 text-sm">{c.name ?? JSON.stringify(c).slice(0,60)}</div>)}
              {(p.classes ?? []).length === 0 && <p className="text-sm text-muted-foreground">No classes assigned.</p>}</CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/**
 * Re-audit #3 P1-12. This tab used to run the year-end rollover itself. It read
 * `r.plan.length` from a response that carries promote/repeat/graduate/skip,
 * so "Execute" committed the whole school and then reported "Rollover failed",
 * with no confirmation step. The Promotion page is the one place that runs it:
 * preview, per-learner decisions, confirmation and per-row errors.
 */
function RolloverTab() {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Year-end promotion</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>Promotion and rollover run from the Promotion page, where you can preview the plan, review each learner and confirm before anything is committed.</p>
        <Button size="sm" asChild><Link to="/school/promotion"><TrendingUp className="h-4 w-4" /> Open Promotion</Link></Button>
      </CardContent>
    </Card>
  );
}
