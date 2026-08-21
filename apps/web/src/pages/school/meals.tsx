import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, UtensilsCrossed, ClipboardCheck, CalendarDays, Play, HandCoins, ChefHat, BarChart3, CreditCard } from 'lucide-react';
import {
  useMealPrograms,
  useCreateMealProgram,
  useMealTypes,
  useCreateMealType,
  useMealPlans,
  useCreateMealPlan,
  useUpdateMealPlan,
  useMealEntitlements,
  useSetEntitlements,
  useTerms,
  useStudents,
  useAssignmentsByTerm,
  useAssignMealPlan,
  useChangeAssignment,
  useTodaysMeals,
  useOpenMealSession,
  useMealSessions,
  useMealRoster,
  useMarkMealAttendance,
  useMealMenus,
  useSchoolMenuCatalog,
  useBuildMenuFromPos,
  useRunMealBilling,
  useWalletTopUp,
  useWalletPurchase,
  useWalletByStudent,
  useMealReports,
  useMealRecipes,
  useCreateMealRecipe,
  useProductionPlans,
  usePlanProduction,
  useIssueProduction,
  useMealConsumption,
  useRecordConsumption,
  type MealAttendanceStatus,
  type MealConsumptionRow,
} from '@/features/school/api';
import { useMenuItems, useMenuCategories, type MenuCategory, type MenuItem } from '@/features/menu/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';

const money = (n: number | string) => `UGX ${Number(n).toLocaleString()}`;
const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';
const today = () => new Date().toISOString().slice(0, 10);

export function SchoolMealsPage() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') ?? 'today';
  const [activeTab, setActiveTab] = useState(initialTab);
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t) setActiveTab(t);
  }, [searchParams]);
  const validTabs = ['today', 'planning', 'assignments', 'attendance', 'menus', 'kitchen', 'consumption', 'finance', 'pos', 'reports'];
  const tab = validTabs.includes(activeTab) ? activeTab : 'today';
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Meals</h1>
        <p className="text-sm text-muted-foreground">
          Meal programs, plans &amp; eligibility, daily sessions &amp; attendance, and menus.
        </p>
      </div>
      <Tabs value={tab} onValueChange={setActiveTab} defaultValue="today">
        <TabsList>
          <TabsTrigger value="today">Today&apos;s Meals</TabsTrigger>
          <TabsTrigger value="planning">Planning</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="menus">Menus</TabsTrigger>
          <TabsTrigger value="kitchen">Kitchen</TabsTrigger>
          <TabsTrigger value="consumption">Consumption</TabsTrigger>
          <TabsTrigger value="finance">Finance</TabsTrigger>
          <TabsTrigger value="pos">Cafeteria POS</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="today" className="pt-4"><TodayTab /></TabsContent>
        <TabsContent value="planning" className="pt-4"><PlanningTab /></TabsContent>
        <TabsContent value="assignments" className="pt-4"><AssignmentsTab /></TabsContent>
        <TabsContent value="attendance" className="pt-4"><AttendanceTab /></TabsContent>
        <TabsContent value="menus" className="pt-4"><MenusTab /></TabsContent>
        <TabsContent value="kitchen" className="pt-4"><KitchenTab /></TabsContent>
        <TabsContent value="consumption" className="pt-4"><ConsumptionTab /></TabsContent>
        <TabsContent value="finance" className="pt-4"><FinanceTab /></TabsContent>
        <TabsContent value="pos" className="pt-4"><POSTab /></TabsContent>
        <TabsContent value="reports" className="pt-4"><ReportsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ─────────────── Today's Meals (home) ─────────────── */

const STATUS_TONE: Record<string, string> = {
  not_started: 'bg-muted text-muted-foreground',
  in_progress: 'bg-amber-100 text-amber-800',
  complete: 'bg-emerald-100 text-emerald-800',
};

function TodayTab() {
  const [date, setDate] = useState(today());
  const { data, isLoading } = useTodaysMeals(date);
  const open = useOpenMealSession();

  const openSession = async (mealTypeId: string) => {
    try {
      await open.mutateAsync({ mealTypeId, date });
      notify.success('Session opened');
    } catch {
      notify.error('Could not open session');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div>
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
        </div>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.meals.map((m) => (
          <Card key={m.mealTypeId}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">{m.mealType}</CardTitle>
              <Badge className={STATUS_TONE[m.status] ?? ''}>{m.status.replace('_', ' ')}</Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Expected</span>
                <span className="font-medium">{m.expected}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Served</span>
                <span className="font-medium">{m.served}</span>
              </div>
              {m.status === 'not_started' && (
                <Button size="sm" variant="outline" className="w-full" onClick={() => openSession(m.mealTypeId)}>
                  <UtensilsCrossed className="mr-1 h-4 w-4" /> Open session
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
        {data && data.meals.length === 0 && (
          <p className="text-sm text-muted-foreground">No meal types configured yet. Add them under Planning.</p>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Planning: programs, types, plans, entitlements ─────────────── */

function PlanningTab() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ProgramsCard />
      <MealTypesCard />
      <PlansCard />
    </div>
  );
}

function ProgramsCard() {
  const { data } = useMealPrograms();
  const create = useCreateMealProgram();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('custom');
  const add = async () => {
    if (!name) return;
    try { await create.mutateAsync({ name, kind }); setName(''); notify.success('Program added'); }
    catch { notify.error('Failed to add program'); }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Programs</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Input placeholder="Program name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className={sel} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="day">Day School</option>
            <option value="day_boarding">Day + Boarding</option>
            <option value="custom">Custom</option>
          </select>
          <Button size="sm" className="w-full" onClick={add}><Plus className="mr-1 h-4 w-4" /> Add program</Button>
        </div>
        <ul className="space-y-1 text-sm">
          {data?.data.map((p) => (
            <li key={p.id} className="flex justify-between rounded border px-2 py-1">
              <span>{p.name}</span><Badge variant="outline">{p.kind}</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function MealTypesCard() {
  const { data } = useMealTypes();
  const create = useCreateMealType();
  const [name, setName] = useState('');
  const [order, setOrder] = useState('');
  const add = async () => {
    if (!name) return;
    try { await create.mutateAsync({ name, order: order ? Number(order) : undefined }); setName(''); setOrder(''); notify.success('Meal type added'); }
    catch { notify.error('Failed to add meal type'); }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Meal types</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input placeholder="e.g. Lunch" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="#" className="w-16" value={order} onChange={(e) => setOrder(e.target.value)} />
        </div>
        <Button size="sm" className="w-full" onClick={add}><Plus className="mr-1 h-4 w-4" /> Add type</Button>
        <ul className="space-y-1 text-sm">
          {data?.data.map((t) => (
            <li key={t.id} className="flex justify-between rounded border px-2 py-1">
              <span>{t.name}</span><span className="text-muted-foreground">#{t.order}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function PlansCard() {
  const { data } = useMealPlans();
  const create = useCreateMealPlan();
  const updatePlan = useUpdateMealPlan();
  const types = useMealTypes();
  const setEnt = useSetEntitlements();
  const catalog = useSchoolMenuCatalog();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [billingModel, setBillingModel] = useState('term_plan');
  const [selectedPlan, setSelectedPlan] = useState('');
  const ent = useMealEntitlements(selectedPlan || undefined);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  // Editor state for the selected plan.
  const plan = data?.data.find((p) => p.id === selectedPlan);
  const [trackInventory, setTrackInventory] = useState(false);
  const [menuPicked, setMenuPicked] = useState<Record<string, boolean>>({});

  const add = async () => {
    if (!name || !price) return;
    try { await create.mutateAsync({ name, pricePerTerm: Number(price), billingModel }); setName(''); setPrice(''); notify.success('Plan added'); }
    catch { notify.error('Failed to add plan'); }
  };
  const saveEntitlements = async () => {
    if (!selectedPlan) return;
    const mealTypeIds = Object.entries(checked).filter(([, v]) => v).map(([k]) => k);
    try { await setEnt.mutateAsync({ mealPlanId: selectedPlan, mealTypeIds }); notify.success('Entitlements saved'); }
    catch { notify.error('Failed to save entitlements'); }
  };
  const pickPlan = (id: string) => {
    setSelectedPlan(id);
    setChecked({});
    setTrackInventory(false);
    setMenuPicked({});
  };
  // seed checkboxes + editor from loaded plan
  useEffect(() => {
    if (ent.data) setChecked(Object.fromEntries(ent.data.map((e) => [e.mealTypeId, true])));
    if (plan) {
      setTrackInventory(!!plan.trackInventory);
      const linked = new Set((plan.menus ?? []).map((m) => m.id));
      setMenuPicked(Object.fromEntries([...linked].map((id) => [id, true])));
    }
  }, [ent.data, plan]);

  const savePlan = async () => {
    if (!selectedPlan) return;
    try {
      await updatePlan.mutateAsync({
        id: selectedPlan,
        trackInventory,
        mealMenuIds: Object.entries(menuPicked).filter(([, v]) => v).map(([k]) => k),
      });
      notify.success('Plan updated');
    } catch { notify.error('Failed to update plan'); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Meal plans</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Input placeholder="Plan name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-2">
            <Input placeholder="Price / term" value={price} onChange={(e) => setPrice(e.target.value)} />
            <select className={sel} value={billingModel} onChange={(e) => setBillingModel(e.target.value)}>
              <option value="term_plan">Term fee</option>
              <option value="wallet">Wallet</option>
              <option value="included">Included</option>
            </select>
          </div>
          <Button size="sm" className="w-full" onClick={add}><Plus className="mr-1 h-4 w-4" /> Add plan</Button>
        </div>
        <div className="space-y-1">
          <Label>Plan</Label>
          <select className={sel} value={selectedPlan} onChange={(e) => pickPlan(e.target.value)}>
            <option value="">Select a plan to configure…</option>
            {data?.data.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.pricePerTerm)}</option>)}
          </select>
        </div>
        {selectedPlan && (
          <div className="space-y-3 rounded border p-2">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Meals included in this plan:</p>
              {types.data?.data.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!checked[t.id]}
                    onChange={(e) => setChecked((c) => ({ ...c, [t.id]: e.target.checked }))}
                  />
                  {t.name}
                </label>
              ))}
              <Button size="sm" variant="outline" className="mt-1 w-full" onClick={saveEntitlements}>Save entitlements</Button>
            </div>

            <div className="border-t pt-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={trackInventory}
                  onChange={(e) => setTrackInventory(e.target.checked)}
                />
                Track inventory on serve
              </label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                When a student is marked served, decrement the menu dish ingredients from stock and record per-student consumption.
              </p>
            </div>

            <div className="border-t pt-2">
              <p className="mb-1 text-xs text-muted-foreground">Menus included in this plan (pick from the school food catalog):</p>
              {catalog.isLoading && <p className="text-sm text-muted-foreground">Loading school menu…</p>}
              <div className="max-h-48 space-y-2 overflow-y-auto rounded border p-2">
                {catalog.data?.map((cat) => (
                  <div key={cat.categoryId ?? '__u'}>
                    <p className="text-xs font-medium uppercase text-muted-foreground">{cat.categoryName}</p>
                    <div className="space-y-1">
                      {cat.items.map((it) => (
                        <label key={it.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                          <input
                            type="checkbox"
                            checked={!!menuPicked[it.id]}
                            onChange={(e) => setMenuPicked((p) => ({ ...p, [it.id]: e.target.checked }))}
                          />
                          <span className="flex-1">{it.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {catalog.data && catalog.data.length === 0 && (
                  <p className="text-sm text-muted-foreground">No school menu items yet — add them on the Menus tab first.</p>
                )}
              </div>
            </div>

            <Button size="sm" className="w-full" onClick={savePlan}>Save plan (inventory + menus)</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─────────────── Assignments ─────────────── */

function AssignmentsTab() {
  const terms = useTerms();
  const [termId, setTermId] = useState('');
  const plans = useMealPlans();
  const [search, setSearch] = useState('');
  const students = useStudents({ search: search || undefined, pageSize: 20 });
  const [studentId, setStudentId] = useState('');
  const [planId, setPlanId] = useState('');
  const assignments = useAssignmentsByTerm(termId || undefined);
  const assign = useAssignMealPlan();
  const change = useChangeAssignment();

  const submit = async () => {
    if (!studentId || !planId || !termId) { notify.error('Pick student, plan and term'); return; }
    try { await assign.mutateAsync({ studentProfileId: studentId, mealPlanId: planId, termId, startDate: today() }); notify.success('Plan assigned'); }
    catch { notify.error('Assign failed'); }
  };
  const end = async (id: string) => {
    try { await change.mutateAsync({ id, status: 'ended' }); notify.success('Assignment ended'); }
    catch { notify.error('Failed'); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Assign a meal plan</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Term</Label>
            <select className={sel} value={termId} onChange={(e) => setTermId(e.target.value)}>
              <option value="">Select term…</option>
              {terms.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Student</Label>
            <Input placeholder="Search student…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className={sel} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">Select student…</option>
              {students.data?.data.map((s) => <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Plan</Label>
            <select className={sel} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Select plan…</option>
              {plans.data?.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <Button className="w-full" onClick={submit}>Assign plan</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Assignments {termId ? '' : '(pick a term)'}</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {assignments.data?.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded border px-2 py-1">
                <span>{a.studentProfile?.partner?.name ?? a.studentProfileId} · {a.mealPlan?.name}</span>
                <span className="flex items-center gap-2">
                  <Badge variant={a.status === 'active' ? 'default' : 'outline'}>{a.status}</Badge>
                  {a.status === 'active' && <Button size="sm" variant="ghost" onClick={() => end(a.id)}>End</Button>}
                </span>
              </li>
            ))}
            {assignments.data && assignments.data.length === 0 && <li className="text-muted-foreground">No assignments for this term.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────── Attendance ─────────────── */

const ATT_CYCLE: MealAttendanceStatus[] = ['served', 'absent', 'excused', 'not_eligible'];
const ATT_TONE: Record<string, string> = {
  served: 'bg-emerald-100 text-emerald-800',
  absent: 'bg-red-100 text-red-800',
  excused: 'bg-amber-100 text-amber-800',
  not_eligible: 'bg-muted text-muted-foreground',
};

function AttendanceTab() {
  const [date, setDate] = useState(today());
  const types = useMealTypes();
  const [mealTypeId, setMealTypeId] = useState('');
  const open = useOpenMealSession();
  const [sessionId, setSessionId] = useState('');
  const roster = useMealRoster(sessionId || undefined);
  const mark = useMarkMealAttendance();
  const [status, setStatus] = useState<Record<string, MealAttendanceStatus>>({});

  const openAndLoad = async () => {
    if (!mealTypeId) { notify.error('Pick a meal type'); return; }
    try {
      const s = await open.mutateAsync({ mealTypeId, date });
      setSessionId(s.id);
      setStatus({});
      notify.success('Session ready');
    } catch { notify.error('Could not open session'); }
  };
  const cycle = (id: string, current: MealAttendanceStatus | null) => {
    const idx = current ? ATT_CYCLE.indexOf(current) : -1;
    setStatus((s) => ({ ...s, [id]: ATT_CYCLE[(idx + 1) % ATT_CYCLE.length] }));
  };
  const save = async () => {
    const entries = (roster.data?.roster ?? []).map((r) => ({
      studentProfileId: r.studentProfileId,
      status: status[r.studentProfileId] ?? r.status ?? 'served',
    }));
    if (entries.length === 0) return;
    try { await mark.mutateAsync({ sessionId, entries }); notify.success(`Marked ${entries.length} student(s)`); }
    catch { notify.error('Failed to save attendance'); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Open a meal session</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" /></div>
          <div className="min-w-40">
            <Label>Meal</Label>
            <select className={sel} value={mealTypeId} onChange={(e) => setMealTypeId(e.target.value)}>
              <option value="">Select…</option>
              {types.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <Button onClick={openAndLoad}><ClipboardCheck className="mr-1 h-4 w-4" /> Load register</Button>
        </CardContent>
      </Card>
      {sessionId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Register</CardTitle>
            <Button size="sm" onClick={save}>Save</Button>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {roster.data?.roster.map((r) => {
                const cur = status[r.studentProfileId] ?? r.status ?? 'served';
                const flags = [...(r.allergies ?? []).map((a: string) => ({ t: a, k: 'allergy' })), ...(r.dietaryRequirements ?? []).map((a: string) => ({ t: a, k: 'diet' }))];
                return (
                  <li key={r.studentProfileId} className="flex items-center justify-between rounded border px-2 py-1">
                    <span className="flex items-center gap-2">{r.name ?? r.studentProfileId} · {r.admissionNo}
                      {flags.length > 0 && <span className="flex gap-1">{flags.map((f, i) => <Badge key={i} variant={f.k === 'allergy' ? 'destructive' : 'secondary'} className="text-[10px]">{f.t}</Badge>)}</span>}
                    </span>
                    <button className={`rounded px-2 py-0.5 text-xs ${ATT_TONE[cur]}`} onClick={() => cycle(r.studentProfileId, cur)}>
                      {cur.replace('_', ' ')}
                    </button>
                  </li>
                );
              })}
              {roster.data && roster.data.roster.length === 0 && (
                <li className="text-muted-foreground">No eligible students — assign a plan with this meal type first.</li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─────────────── Menus ─────────────── */

function MenusTab() {
  const types = useMealTypes();
  const [mealTypeId, setMealTypeId] = useState('');
  const menus = useMealMenus(mealTypeId || undefined);
  const [date, setDate] = useState(today());
  const [title, setTitle] = useState('');

  // Real menu items from /menu (same source as the Menu page list).
  const catalog = useMenuItems({ page: 1, pageSize: 200, search: '' });
  const cats = useMenuCategories();
  const buildFromPos = useBuildMenuFromPos();
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  // Group the menu items by category, exactly like the Menu page list.
  const liveCats = (cats.data ?? []).filter((c: MenuCategory) => !c.deletedAt);
  const items = catalog.data?.data ?? [];
  const grouped = useMemo(() => {
    const byCat = new Map<string | null, MenuItem[]>();
    for (const it of items) {
      const key = it.categoryId;
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key)!.push(it);
    }
    return byCat;
  }, [items]);

  const buildFromPosMenu = async () => {
    if (!mealTypeId) { notify.error('Pick a meal type'); return; }
    const posMenuItemIds = Object.entries(picked).filter(([, v]) => v).map(([k]) => k);
    if (posMenuItemIds.length === 0) { notify.error('Select at least one dish'); return; }
    try { await buildFromPos.mutateAsync({ mealTypeId, date, title: title || undefined, posMenuItemIds }); setTitle(''); setPicked({}); notify.success(`Menu built from ${posMenuItemIds.length} dishes`); }
    catch { notify.error('Failed to build menu'); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Build menu from school menu</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Meal type</Label>
            <select className={sel} value={mealTypeId} onChange={(e) => setMealTypeId(e.target.value)}>
              <option value="">Select…</option>
              {types.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <div className="flex-1"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="flex-1"><Label>Title</Label><Input placeholder="e.g. Monday Lunch" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          </div>
          <div className="space-y-2">
            <Label>Pick dishes from the menu list</Label>
            {catalog.isLoading && <p className="text-sm text-muted-foreground">Loading menu…</p>}
            <div className="max-h-64 space-y-3 overflow-y-auto rounded border p-2">
              {liveCats.map((cat) => {
                const its = grouped.get(cat.id) ?? [];
                if (its.length === 0) return null;
                return (
                  <div key={cat.id}>
                    <p className="text-xs font-medium uppercase text-muted-foreground">{cat.name}</p>
                    <div className="space-y-1">
                      {its.map((it) => (
                        <label key={it.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                          <input
                            type="checkbox"
                            checked={!!picked[it.id]}
                            onChange={(e) => setPicked((p) => ({ ...p, [it.id]: e.target.checked }))}
                          />
                          <span className="flex-1">{it.name}</span>
                          <span className="text-xs text-muted-foreground">{it.basePrice ? money(it.basePrice) : ''}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
              {grouped.get(null)?.length ? (
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Uncategorized</p>
                  <div className="space-y-1">
                    {grouped.get(null)!.map((it) => (
                      <label key={it.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                        <input
                          type="checkbox"
                          checked={!!picked[it.id]}
                          onChange={(e) => setPicked((p) => ({ ...p, [it.id]: e.target.checked }))}
                        />
                        <span className="flex-1">{it.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              {catalog.data && items.length === 0 && (
                <p className="text-sm text-muted-foreground">No menu items yet — add them on the Menu page first.</p>
              )}
            </div>
          </div>
          <Button className="w-full" onClick={buildFromPosMenu}>
            <CalendarDays className="mr-1 h-4 w-4" /> Build menu from selected dishes
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Menus</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {menus.data?.map((m) => (
              <li key={m.id} className="rounded border p-2">
                <div className="flex justify-between">
                  <span className="font-medium">{m.title ?? m.mealType?.name}</span>
                  <span className="text-muted-foreground">{m.date?.slice(0, 10)}</span>
                </div>
                <div className="text-muted-foreground">
                  {m.items?.map((i) => i.name).join(', ')}
                </div>
                {m.items?.some((i) => i.posMenuItemId) && (
                  <Badge variant="outline" className="mt-1">From Menu</Badge>
                )}
              </li>
            ))}
            {menus.data && menus.data.length === 0 && <li className="text-muted-foreground">No menus yet.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────── Consumption (per-student / per-lunch) ─────────────── */

function ConsumptionTab() {
  const [date, setDate] = useState(today());
  const sessions = useMealSessions(date, date);
  const [sessionId, setSessionId] = useState('');
  const record = useRecordConsumption();
  const rows = useMealConsumption(sessionId ? { mealSessionId: sessionId } : {});

  // Aggregate per-student consumption for the selected session.
  const byStudent = useMemo(() => {
    const map = new Map<string, { name?: string | null; items: MealConsumptionRow[] }>();
    for (const r of rows.data ?? []) {
      const key = r.studentProfileId ?? 'unknown';
      if (!map.has(key)) map.set(key, { name: r.studentProfile?.partner?.name ?? null, items: [] });
      map.get(key)!.items.push(r);
    }
    return [...map.entries()];
  }, [rows.data]);

  const recordFor = async (studentProfileId: string, mealMenuId?: string) => {
    if (!sessionId) { notify.error('Pick a session first'); return; }
    try { await record.mutateAsync({ mealSessionId: sessionId, studentProfileId, mealMenuId }); notify.success('Consumption recorded'); }
    catch { notify.error('Record failed'); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Per-lunch consumption</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSessionId(''); }} className="w-44" /></div>
          <div className="min-w-48">
            <Label>Session</Label>
            <select className={sel} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              <option value="">Select…</option>
              {sessions.data?.map((s: any) => (
                <option key={s.id} value={s.id}>{s.mealType?.name} · {s.date?.slice(0, 10)} · {s.servedCount ?? 0} served</option>
              ))}
            </select>
          </div>
          {sessions.isLoading && <span className="text-sm text-muted-foreground">Loading sessions…</span>}
          {sessions.data && sessions.data.length === 0 && <span className="text-sm text-muted-foreground">No sessions for this date.</span>}
        </CardContent>
      </Card>

      {sessionId && (
        <Card>
          <CardHeader><CardTitle className="text-base">Students served (per-lunch)</CardTitle></CardHeader>
          <CardContent>
            {rows.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : byStudent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No consumption recorded yet for this session. Mark a student served (Attendance tab) or use “Record” to log their lunch against inventory.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {byStudent.map(([sid, info]: [string, { name?: string | null; items: MealConsumptionRow[] }]) => (
                  <li key={sid} className="rounded border p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{info.name ?? sid}</span>
                      <button
                        className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
                        onClick={() => recordFor(sid)}
                        disabled={record.isPending}
                      >Record / re-log</button>
                    </div>
                    <ul className="mt-1 space-y-0.5 pl-2 text-xs text-muted-foreground">
                      {info.items.map((it: MealConsumptionRow) => (
                        <li key={it.id} className="flex justify-between">
                          <span>{it.product?.name ?? it.productId}</span>
                          <span>{it.quantity} {it.unitCost ? `· ${money(it.unitCost)}/u` : ''}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─────────────── Kitchen (V3) ─────────────── */

const PROD_TONE: Record<string, string> = {
  preparing: 'bg-amber-100 text-amber-800',
  ready: 'bg-emerald-100 text-emerald-800',
  served: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-muted text-muted-foreground',
};

function KitchenTab() {
  const recipes = useMealRecipes();
  const createRecipe = useCreateMealRecipe();
  const types = useMealTypes();
  const plans = useProductionPlans();
  const plan = usePlanProduction();
  const issue = useIssueProduction();

  const [rName, setRName] = useState('');
  const [rProduct, setRProduct] = useState('');
  const [rQty, setRQty] = useState('');
  const [mealTypeId, setMealTypeId] = useState('');
  const [date, setDate] = useState(today());
  const [portions, setPortions] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const addRecipe = async () => {
    if (!rName) return;
    const ingredients = rProduct && rQty ? [{ productId: rProduct, quantityPerPortion: Number(rQty) }] : [];
    try { await createRecipe.mutateAsync({ name: rName, ingredients }); setRName(''); setRProduct(''); setRQty(''); notify.success('Recipe added'); }
    catch { notify.error('Failed to add recipe'); }
  };
  const doPlan = async () => {
    const mealRecipeIds = Object.entries(picked).filter(([, v]) => v).map(([k]) => k);
    if (!mealTypeId || mealRecipeIds.length === 0) { notify.error('Pick meal type and recipes'); return; }
    try { await plan.mutateAsync({ mealTypeId, date, expectedPortions: portions ? Number(portions) : undefined, mealRecipeIds }); notify.success('Production planned'); }
    catch { notify.error('Failed to plan'); }
  };
  const doIssue = async (id: string) => {
    try { await issue.mutateAsync({ id }); notify.success('Issued to kitchen — stock decremented'); }
    catch { notify.error('Issue failed'); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Recipes</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Recipe name (e.g. Beans)" value={rName} onChange={(e) => setRName(e.target.value)} />
          <div className="flex gap-2">
            <Input placeholder="Ingredient product ID" value={rProduct} onChange={(e) => setRProduct(e.target.value)} />
            <Input placeholder="qty/portion" className="w-28" value={rQty} onChange={(e) => setRQty(e.target.value)} />
          </div>
          <Button size="sm" className="w-full" onClick={addRecipe}><Plus className="mr-1 h-4 w-4" /> Add recipe</Button>
          <ul className="space-y-1 text-sm">
            {recipes.data?.map((r) => (
              <li key={r.id} className="flex justify-between rounded border px-2 py-1">
                <span>{r.name}</span><span className="text-muted-foreground">{r.ingredients?.length ?? 0} ingredient(s)</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Production plan</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <select className={sel} value={mealTypeId} onChange={(e) => setMealTypeId(e.target.value)}>
              <option value="">Meal…</option>
              {types.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Input placeholder="portions" className="w-24" value={portions} onChange={(e) => setPortions(e.target.value)} />
          </div>
          <div className="space-y-1 rounded border p-2">
            <p className="text-xs text-muted-foreground">Recipes to produce:</p>
            {recipes.data?.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!picked[r.id]} onChange={(e) => setPicked((p) => ({ ...p, [r.id]: e.target.checked }))} />
                {r.name}
              </label>
            ))}
          </div>
          <Button size="sm" className="w-full" onClick={doPlan}><ChefHat className="mr-1 h-4 w-4" /> Plan production</Button>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Production runs</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {plans.data?.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded border px-2 py-1">
                <span>{p.mealType?.name} · {p.date.slice(0, 10)} · {p.expectedPortions} portions</span>
                <span className="flex items-center gap-2">
                  <Badge className={PROD_TONE[p.status] ?? ''}>{p.status}</Badge>
                  {p.status === 'preparing' && <Button size="sm" variant="outline" onClick={() => doIssue(p.id)}>Issue</Button>}
                </span>
              </li>
            ))}
            {plans.data && plans.data.length === 0 && <li className="text-muted-foreground">No production runs yet.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────── Finance (V2) ─────────────── */

function FinanceTab() {
  const terms = useTerms();
  const plans = useMealPlans();
  const runBilling = useRunMealBilling();
  const topUp = useWalletTopUp();
  const [termId, setTermId] = useState('');
  const [search, setSearch] = useState('');
  const students = useStudents({ search: search || undefined, pageSize: 20 });
  const [studentId, setStudentId] = useState('');
  const [planId, setPlanId] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');

  const runTermBilling = async () => {
    if (!termId) { notify.error('Pick a term'); return; }
    try { const r = await runBilling.mutateAsync({ termId }); notify.success(`Billed ${r.count} student(s)`); }
    catch { notify.error('Billing run failed'); }
  };
  const doTopUp = async () => {
    if (!studentId || !planId || !amount) { notify.error('Pick student, plan and amount'); return; }
    try { await topUp.mutateAsync({ studentProfileId: studentId, mealPlanId: planId, amount: Number(amount), reference: reference || undefined }); setAmount(''); setReference(''); notify.success('Wallet topped up'); }
    catch { notify.error('Top-up failed'); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Term meal-plan billing</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Raises one AR invoice per active term-plan assignment (posted to the GL like tuition).
          </p>
          <div className="space-y-1">
            <Label>Term</Label>
            <select className={sel} value={termId} onChange={(e) => setTermId(e.target.value)}>
              <option value="">Select term…</option>
              {terms.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <Button className="w-full" onClick={runTermBilling}><Play className="mr-1 h-4 w-4" /> Run billing</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Cafeteria wallet top-up</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">Prepaid stored value (a liability, not revenue until spent).</p>
          <Input placeholder="Search student…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className={sel} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select student…</option>
            {students.data?.data.map((s) => <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>)}
          </select>
          <select className={sel} value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Select plan…</option>
            {plans.data?.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="flex gap-2">
            <Input placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Input placeholder="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <Button className="w-full" onClick={doTopUp}><HandCoins className="mr-1 h-4 w-4" /> Top up wallet</Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────── Cafeteria POS (P2) ─────────────── */

function POSTab() {
  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState('');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('Meal purchase');
  const students = useStudents({ search: search || undefined, pageSize: 20 });
  const wallet = useWalletByStudent(studentId || undefined);
  const purchase = useWalletPurchase();
  const mealAccountId = (wallet.data as any)?.id ?? '';
  const doCharge = async () => {
    if (!mealAccountId) { notify.error('Wallet not loaded'); return; }
    if (!amount || Number(amount) <= 0) { notify.error('Enter an amount'); return; }
    if (Number(amount) > (wallet.data?.balance ?? 0)) { notify.error(`Insufficient balance (${wallet.data?.balance ?? 0})`); return; }
    try {
      await purchase.mutateAsync({ mealAccountId, amount: Number(amount), description: desc || 'Meal purchase' });
      notify.success('Charged to wallet'); setAmount('');
    } catch { notify.error('Charge failed'); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><CreditCard className="h-4 w-4" /> Cafeteria POS — charge a meal</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Search student…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className={sel} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select student…</option>
            {students.data?.data.map((s: any) => <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>)}
          </select>
          {studentId && (
            <div className="rounded-md border bg-muted/40 p-2 text-sm">
              Wallet balance: <span className="font-semibold">{(wallet.data?.balance ?? 0).toLocaleString()}</span>
              {!wallet.data?.exists && <span className="ml-2 text-rose-600">No wallet — top up first</span>}
            </div>
          )}
          <Input placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Button className="w-full" onClick={doCharge} disabled={purchase.isPending || !mealAccountId}>
            <HandCoins className="mr-1 h-4 w-4" /> Charge wallet
          </Button>
          <p className="text-xs text-muted-foreground">Deducts from the student&apos;s prepaid cafeteria wallet and records a purchase ledger entry.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">How it works</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>1. Find the student and confirm their wallet balance.</p>
          <p>2. Enter the meal amount and a description.</p>
          <p>3. Charge — the wallet balance decreases and a purchase is logged (auditable via the Finance tab history).</p>
          <p>Top-ups are handled in the Finance tab; this POS is for day-to-day meal charges.</p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────── Reports (P1) ─────────────── */

function ReportsTab() {
  const [days, setDays] = useState(30);
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { data, isLoading } = useMealReports(from, to);

  const cards = [
    { label: 'Attendance', sub: data ? `${data.attendance.served}/${data.attendance.expected} served` : '—', value: data ? `${data.attendance.rate}%` : '—' },
    { label: 'Waste', sub: data ? `${data.waste.wasteQty} units · ${data.waste.wasteCost} cost` : '—', value: data ? `${data.waste.wastePct}%` : '—' },
    { label: 'Production cost', sub: 'food consumed', value: data ? `${data.production.foodCost}` : '—' },
    { label: 'Wallet', sub: data ? `top-ups ${data.wallet.topUps}` : '—', value: data ? `spent ${data.wallet.purchases}` : '—' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="space-y-1"><Label className="text-xs">Window</Label>
          <select className={sel} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select></div>
        <Badge variant="secondary"><BarChart3 className="h-3 w-3 mr-1" /> {from} → {to}</Badge>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">{c.label}</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-semibold">{c.value}</div><div className="text-xs text-muted-foreground">{c.sub}</div></CardContent></Card>
        ))}
      </div>
      {data && (
        <Card>
          <CardHeader><CardTitle className="text-base">Detail</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span>Meals served / expected</span><span>{data.attendance.served} / {data.attendance.expected}</span></div>
            <div className="flex justify-between"><span>Attendance rate</span><span>{data.attendance.rate}%</span></div>
            <div className="flex justify-between"><span>Production plans</span><span>{data.production.plans}</span></div>
            <div className="flex justify-between"><span>Ingredients consumed (qty)</span><span>{data.production.consumedQty}</span></div>
            <div className="flex justify-between"><span>Waste records / cost</span><span>{data.waste.records} / {data.waste.wasteCost}</span></div>
            <div className="flex justify-between"><span>Waste % of food cost</span><span>{data.waste.wastePct}%</span></div>
            <div className="flex justify-between"><span>Wallet top-ups</span><span>{data.wallet.topUps}</span></div>
            <div className="flex justify-between"><span>Wallet purchases</span><span>{data.wallet.purchases}</span></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
