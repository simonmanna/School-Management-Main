import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, Unlink, UserPlus, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  useHrReconciliation,
  useHrLinkStaff,
  useHrUnlinkStaff,
  useHrCreateEmployeeFromStaff,
  useHrCreateStaffFromEmployee,
} from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';

const err = (e: any) => notify.error(e?.response?.data?.message ?? 'Something went wrong');
const empName = (e: any) => `${e.firstName ?? ''}${e.lastName ? ' ' + e.lastName : ''}`.trim() || e.employeeCode;

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export function HrReconciliationPage() {
  const { data, isLoading } = useHrReconciliation();
  const link = useHrLinkStaff();
  const unlink = useHrUnlinkStaff();
  const createEmp = useHrCreateEmployeeFromStaff();
  const createStaff = useHrCreateStaffFromEmployee();

  // Link dialog: pick which school profile an HR-only employee belongs to.
  const [linkFor, setLinkFor] = useState<any | null>(null);
  const [pickStaffId, setPickStaffId] = useState('');
  const [staffSearch, setStaffSearch] = useState('');

  const schoolOnly = data?.schoolOnly ?? [];
  const candidates = useMemo(() => {
    if (!staffSearch) return schoolOnly;
    const q = staffSearch.toLowerCase();
    return schoolOnly.filter(
      (s: any) =>
        (s.partner?.name ?? '').toLowerCase().includes(q) || s.employeeNo.toLowerCase().includes(q),
    );
  }, [schoolOnly, staffSearch]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const counts = data?.counts;

  const doLink = () => {
    if (!linkFor || !pickStaffId) return;
    link.mutate(
      { employeeId: linkFor.id, staffProfileId: pickStaffId },
      { onSuccess: () => { setLinkFor(null); setPickStaffId(''); notify.success('Linked'); }, onError: err },
    );
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Staff record reconciliation</h1>
        <p className="text-sm text-muted-foreground">
          The school roster and the HR payroll record are two facets of the same person, joined
          through their master-data Partner. Exact matches were linked automatically; anything
          ambiguous is listed here so a human decides — a wrong link would move someone's salary
          onto another person's record.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Linked" value={counts?.linked ?? 0} tone="text-emerald-700" />
        <Stat label="HR only (no roster entry)" value={counts?.hrOnly ?? 0} tone="text-amber-700" />
        <Stat label="School only (no payroll record)" value={counts?.schoolOnly ?? 0} tone="text-sky-700" />
      </div>

      <Tabs defaultValue={(counts?.schoolOnly ?? 0) > 0 ? 'schoolOnly' : 'linked'}>
        <TabsList>
          <TabsTrigger value="linked">Linked ({counts?.linked ?? 0})</TabsTrigger>
          <TabsTrigger value="hrOnly">HR only ({counts?.hrOnly ?? 0})</TabsTrigger>
          <TabsTrigger value="schoolOnly">School only ({counts?.schoolOnly ?? 0})</TabsTrigger>
        </TabsList>

        {/* ── Linked ─────────────────────────────────────────────────────── */}
        <TabsContent value="linked" className="mt-4">
          <Card>
            <CardHeader className="border-b bg-muted/30">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Fully linked people
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(data?.linked ?? []).length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Nothing linked yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead><TableHead>HR code</TableHead>
                      <TableHead>Roster no.</TableHead><TableHead>Category</TableHead>
                      <TableHead className="w-[1%]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.linked ?? []).map(({ employee, staffProfile }: any) => (
                      <TableRow key={employee.id}>
                        <TableCell className="font-medium">
                          <Link to={`/hr/employees/${employee.id}`} className="hover:underline">
                            {staffProfile.partner?.name ?? empName(employee)}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{employee.employeeCode}</TableCell>
                        <TableCell className="font-mono text-xs">{staffProfile.employeeNo}</TableCell>
                        <TableCell><Badge variant="outline">{staffProfile.staffCategory}</Badge></TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => unlink.mutate(employee.id, { onSuccess: () => notify.success('Unlinked'), onError: err })}
                          >
                            <Unlink className="mr-1 h-4 w-4" />Unlink
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── HR only ────────────────────────────────────────────────────── */}
        <TabsContent value="hrOnly" className="mt-4">
          <Card>
            <CardHeader className="border-b bg-muted/30">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" /> On payroll, missing from the school roster
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(data?.hrOnly ?? []).length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">None — every employee has a roster entry.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead><TableHead>Code</TableHead>
                      <TableHead>Email</TableHead><TableHead className="w-[1%]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.hrOnly ?? []).map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">
                          <Link to={`/hr/employees/${e.id}`} className="hover:underline">{empName(e)}</Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{e.employeeCode}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.email ?? '—'}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => { setLinkFor(e); setPickStaffId(''); }}>
                              <Link2 className="mr-1 h-4 w-4" />Link to roster
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => createStaff.mutate({ employeeId: e.id }, { onSuccess: () => notify.success('Roster entry created'), onError: err })}
                            >
                              <UserPlus className="mr-1 h-4 w-4" />Create roster entry
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── School only ────────────────────────────────────────────────── */}
        <TabsContent value="schoolOnly" className="mt-4">
          <Card>
            <CardHeader className="border-b bg-muted/30">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-sky-600" /> On the roster, no payroll record
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {schoolOnly.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">None — every staff member has an HR record.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead><TableHead>Roster no.</TableHead>
                      <TableHead>Category</TableHead><TableHead>Department</TableHead>
                      <TableHead className="w-[1%]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schoolOnly.map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.partner?.name ?? s.employeeNo}</TableCell>
                        <TableCell className="font-mono text-xs">{s.employeeNo}</TableCell>
                        <TableCell><Badge variant="outline">{s.staffCategory}</Badge></TableCell>
                        <TableCell>{s.department?.name ?? '—'}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            onClick={() =>
                              createEmp.mutate(
                                { staffProfileId: s.id },
                                { onSuccess: () => notify.success('HR record created'), onError: err },
                              )
                            }
                          >
                            <UserPlus className="mr-1 h-4 w-4" />Create HR record
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Link an HR-only employee to an existing roster entry. */}
      <Dialog open={!!linkFor} onOpenChange={(o) => !o && setLinkFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link {linkFor ? empName(linkFor) : ''} to a roster entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Search the roster</Label>
              <Input value={staffSearch} onChange={(e) => setStaffSearch(e.target.value)} placeholder="Name or employee no…" />
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded border p-1">
              {candidates.length === 0 && (
                <p className="p-3 text-center text-sm text-muted-foreground">No unlinked roster entries.</p>
              )}
              {candidates.map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => setPickStaffId(s.id)}
                  className={`w-full rounded px-3 py-2 text-left text-sm hover:bg-muted ${pickStaffId === s.id ? 'bg-muted ring-1 ring-primary' : ''}`}
                >
                  <div className="font-medium">{s.partner?.name ?? s.employeeNo}</div>
                  <div className="text-xs text-muted-foreground">{s.employeeNo} · {s.staffCategory}</div>
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkFor(null)}>Cancel</Button>
            <Button onClick={doLink} disabled={!pickStaffId || link.isPending}>Link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
