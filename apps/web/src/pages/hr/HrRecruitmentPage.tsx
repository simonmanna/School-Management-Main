import { useMemo, useState } from 'react';
import { Plus, UserPlus, Briefcase } from 'lucide-react';
import { useHrVacancies, useCreateHrVacancy, useHrApplicants, useCreateHrApplicant, useSetHrApplicantStatus, useHireHrApplicant, useHrPositions } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const STATUSES = ['APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'];

export function HrRecruitmentPage() {
  const [vacOpen, setVacOpen] = useState(false);
  const [appOpen, setAppOpen] = useState(false);
  const [appForm, setAppForm] = useState<any>({});
  const [vacForm, setVacForm] = useState<any>({});
  const { data: vacancies } = useHrVacancies({});
  const { data: applicants } = useHrApplicants({});
  const { data: posData } = useHrPositions({});
  const createVac = useCreateHrVacancy();
  const createApp = useCreateHrApplicant();
  const setStatus = useSetHrApplicantStatus();
  const hire = useHireHrApplicant();

  const vacRows = useMemo(() => vacancies?.rows ?? [], [vacancies]);
  const appRows = useMemo(() => applicants?.rows ?? [], [applicants]);
  const positions = useMemo(() => posData?.rows ?? [], [posData]);

  const submitVac = async () => {
    if (!vacForm.title) return;
    await createVac.mutateAsync({ title: vacForm.title, positionId: vacForm.positionId || null, openings: vacForm.openings ? Number(vacForm.openings) : 1, status: 'OPEN', salaryMin: vacForm.salaryMin ? Number(vacForm.salaryMin) : null, salaryMax: vacForm.salaryMax ? Number(vacForm.salaryMax) : null, requirements: vacForm.requirements || null });
    setVacOpen(false);
  };
  const submitApp = async () => {
    if (!appForm.vacancyId || !appForm.firstName) return;
    await createApp.mutateAsync({ vacancyId: appForm.vacancyId, firstName: appForm.firstName, lastName: appForm.lastName || null, email: appForm.email || null, phone: appForm.phone || null, experienceYears: appForm.experienceYears ? Number(appForm.experienceYears) : null, expectedSalary: appForm.expectedSalary ? Number(appForm.expectedSalary) : null, status: 'APPLIED' });
    setAppOpen(false);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Recruitment / Applicant Tracking</h1>
          <p className="text-sm text-muted-foreground">Vacancies → applicants → screening → interview → offer → hire (creates an employee).</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setVacForm({ openings: 1 }); setVacOpen(true); }}><Plus className="h-4 w-4" /> Vacancy</Button>
          <Button onClick={() => { setAppForm({}); setAppOpen(true); }}><UserPlus className="h-4 w-4" /> Applicant</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">{vacRows.length} vacancies</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {vacRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No vacancies yet.</p>}
              {vacRows.map((v: any) => (
                <div key={v.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                  <div className="flex items-center gap-3">
                    <Briefcase className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{v.title}</p>
                      <p className="text-xs text-muted-foreground">{v._count?.applicants ?? 0} applicants · {v.openings} openings</p>
                    </div>
                  </div>
                  <Badge variant="outline" className={v.status === 'OPEN' ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}>{v.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">{appRows.length} applicants</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {appRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No applicants yet.</p>}
              {appRows.map((a: any) => (
                <div key={a.id} className="px-4 py-3 hover:bg-muted/40">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{a.firstName} {a.lastName ?? ''}</p>
                      <p className="text-xs text-muted-foreground">{a.email || a.phone || ''} · {a.vacancy?.title}</p>
                    </div>
                    <select value={a.status} onChange={(e) => setStatus.mutateAsync({ id: a.id, status: e.target.value })}
                      className="rounded-md border bg-card px-2 py-1 text-xs">
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  {a.status !== 'HIRED' && a.status !== 'REJECTED' && (
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => hire.mutateAsync({ id: a.id, dto: { employeeCode: `EMP${Date.now().toString().slice(-6)}`, payFrequency: 'MONTHLY' } })}>Hire → employee</Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={vacOpen} onOpenChange={setVacOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New vacancy</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Title *</Label><Input value={vacForm.title ?? ''} onChange={(e) => setVacForm({ ...vacForm, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Position</Label>
                <select value={vacForm.positionId ?? ''} onChange={(e) => setVacForm({ ...vacForm, positionId: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                  <option value="">None</option>
                  {positions.map((p: any) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </select>
              </div>
              <div><Label>Openings</Label><Input type="number" value={vacForm.openings ?? 1} onChange={(e) => setVacForm({ ...vacForm, openings: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Salary min</Label><Input type="number" value={vacForm.salaryMin ?? ''} onChange={(e) => setVacForm({ ...vacForm, salaryMin: e.target.value })} /></div>
              <div><Label>Salary max</Label><Input type="number" value={vacForm.salaryMax ?? ''} onChange={(e) => setVacForm({ ...vacForm, salaryMax: e.target.value })} /></div>
            </div>
            <div><Label>Requirements</Label><Input value={vacForm.requirements ?? ''} onChange={(e) => setVacForm({ ...vacForm, requirements: e.target.value })} /></div>
            <Button onClick={submitVac} disabled={createVac.isPending}>Create vacancy</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={appOpen} onOpenChange={setAppOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New applicant</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Vacancy *</Label>
              <select value={appForm.vacancyId ?? ''} onChange={(e) => setAppForm({ ...appForm, vacancyId: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">Select vacancy</option>
                {vacRows.map((v: any) => <option key={v.id} value={v.id}>{v.title}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>First name *</Label><Input value={appForm.firstName ?? ''} onChange={(e) => setAppForm({ ...appForm, firstName: e.target.value })} /></div>
              <div><Label>Last name</Label><Input value={appForm.lastName ?? ''} onChange={(e) => setAppForm({ ...appForm, lastName: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input value={appForm.email ?? ''} onChange={(e) => setAppForm({ ...appForm, email: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={appForm.phone ?? ''} onChange={(e) => setAppForm({ ...appForm, phone: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Experience (yrs)</Label><Input type="number" value={appForm.experienceYears ?? ''} onChange={(e) => setAppForm({ ...appForm, experienceYears: e.target.value })} /></div>
              <div><Label>Expected salary</Label><Input type="number" value={appForm.expectedSalary ?? ''} onChange={(e) => setAppForm({ ...appForm, expectedSalary: e.target.value })} /></div>
            </div>
            <Button onClick={submitApp} disabled={createApp.isPending}>Add applicant</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
