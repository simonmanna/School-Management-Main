import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save, Search, Printer, FileSpreadsheet, FileText, X, Loader2, Info } from 'lucide-react';
import {
  useAcademicYears,
  useTerms,
  useClasses,
  useFeeCategories,
  useOptionalFeeRoster,
  useSaveOptionalFees,
  type OptionalFeeRow,
} from '@/features/school/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';
import { exportCSV } from '@/lib/export-csv';
import { selectCls, Field } from './_components/catalog-page';
import { money, apiError } from './fees-shared';

/**
 * Optional Fees — the per-student opt-in roster.
 *
 * Mandatory categories need no screen: billing charges them to every student a
 * fee structure covers. An OPTIONAL category is the opposite — it charges
 * nobody until a bursar puts a student on this list. Typing an amount opts the
 * student in; clearing it opts them out. Blank amount with the box ticked means
 * "charge whatever the fee structure says", so a school with one swimming price
 * never has to retype it 400 times.
 */

type Edit = { amount: string; optedIn: boolean };

export function SchoolOptionalFeesPage() {
  const { data: years } = useAcademicYears();
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();
  const { data: categories } = useFeeCategories();
  const saveFees = useSaveOptionalFees();

  const [yearId, setYearId] = useState('');
  const [termId, setTermId] = useState('');
  const [feeCategoryId, setCategoryId] = useState('');
  const [classId, setClassId] = useState('');
  const [query, setQuery] = useState('');
  const [edits, setEdits] = useState<Record<string, Edit>>({});

  const optionalCats = useMemo(
    () => (categories?.data ?? []).filter((c) => c.type === 'optional' && c.isActive),
    [categories],
  );
  const termsForYear = useMemo(
    () => (terms?.data ?? []).filter((t) => !yearId || t.academicYearId === yearId),
    [terms, yearId],
  );

  // Default the filters to the current year/term and the first optional
  // category, so the screen is useful on arrival instead of four empty selects.
  useEffect(() => {
    if (!yearId && years?.data?.length) setYearId((years.data.find((y) => y.isCurrent) ?? years.data[0]).id);
  }, [years, yearId]);
  useEffect(() => {
    if (termsForYear.length && !termsForYear.some((t) => t.id === termId)) {
      setTermId((termsForYear.find((t) => t.isCurrent) ?? termsForYear[0]).id);
    }
  }, [termsForYear, termId]);
  useEffect(() => {
    if (!feeCategoryId && optionalCats.length) setCategoryId(optionalCats[0].id);
  }, [optionalCats, feeCategoryId]);

  const { data: roster, isLoading, isFetching } = useOptionalFeeRoster({ termId, feeCategoryId, classId });

  // A fresh roster is the new baseline — drop any half-typed edits so the grid
  // never shows amounts belonging to the previously selected term or class.
  useEffect(() => {
    setEdits({});
  }, [termId, feeCategoryId, classId]);

  const rows = useMemo(() => {
    const all = roster?.rows ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (r) => r.name.toLowerCase().includes(q) || r.admissionNo.toLowerCase().includes(q) || r.className.toLowerCase().includes(q),
    );
  }, [roster, query]);

  const stateOf = (r: OptionalFeeRow): Edit =>
    edits[r.studentProfileId] ?? { amount: r.amount != null ? String(r.amount) : '', optedIn: r.optedIn };

  const setEdit = (r: OptionalFeeRow, patch: Partial<Edit>) =>
    setEdits((e) => ({ ...e, [r.studentProfileId]: { ...stateOf(r), ...patch } }));

  /** Typing an amount opts the student in; clearing it leaves the tick alone. */
  const onAmount = (r: OptionalFeeRow, value: string) =>
    setEdit(r, { amount: value, optedIn: value.trim() !== '' ? true : stateOf(r).optedIn });

  const clearRow = (r: OptionalFeeRow) => setEdit(r, { amount: '', optedIn: false });

  const dirty = Object.keys(edits).length > 0;
  const assigned = (roster?.rows ?? []).filter((r) => stateOf(r).optedIn);
  // Only rows carrying an explicit amount can be summed — a blank amount means
  // "whatever the fee structure charges", which this screen does not know.
  const overrides = assigned.filter((r) => stateOf(r).amount.trim() !== '');
  const overrideTotal = overrides.reduce((s, r) => s + (Number(stateOf(r).amount) || 0), 0);

  const applyToAll = () => {
    const first = rows.find((r) => stateOf(r).amount.trim() !== '');
    if (!first) {
      notify.error('Type an amount on one row first, then apply it to the rest.');
      return;
    }
    const amount = stateOf(first).amount;
    const next = { ...edits };
    for (const r of rows) next[r.studentProfileId] = { amount, optedIn: true };
    setEdits(next);
    notify.success(`${money(Number(amount))} applied to ${rows.length} student(s) — not saved yet.`);
  };

  const clearAll = () => {
    const next = { ...edits };
    for (const r of rows) next[r.studentProfileId] = { amount: '', optedIn: false };
    setEdits(next);
  };

  const save = async () => {
    const payload = (roster?.rows ?? []).map((r) => {
      const st = stateOf(r);
      const amount = st.amount.trim() === '' ? null : Number(st.amount);
      return { studentProfileId: r.studentProfileId, amount, isActive: st.optedIn };
    });
    try {
      const res = await saveFees.mutateAsync({ termId, feeCategoryId, rows: payload });
      setEdits({});
      notify.success(
        `Optional fees saved · ${res.created} added, ${res.updated} updated, ${res.removed} removed`,
      );
    } catch (e) {
      notify.error(apiError(e, 'Could not save optional fees'));
    }
  };

  const doExport = (ext: 'csv' | 'xls') =>
    exportCSV(
      `optional-fees-${roster?.category?.code ?? 'fees'}.${ext}`,
      ['#', 'Admission No', 'Student', 'Class', 'Assigned', 'Amount'],
      rows.map((r, i) => {
        const st = stateOf(r);
        return [
          String(i + 1),
          r.admissionNo,
          r.name,
          r.className,
          st.optedIn ? 'Yes' : 'No',
          st.amount || '',
        ];
      }),
    );

  const yearName = (years?.data ?? []).find((y) => y.id === yearId)?.name ?? '';
  const termName = termsForYear.find((t) => t.id === termId)?.name ?? '';

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Optional Fees</h1>
          <p className="text-sm text-muted-foreground">
            Assign optional fee categories to individual students. Only the students listed here are billed for the fee.
          </p>
        </div>
        <Button onClick={save} disabled={!dirty || saveFees.isPending || !termId || !feeCategoryId}>
          {saveFees.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          {dirty ? ` (${Object.keys(edits).length})` : ''}
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button variant="outline" size="sm" onClick={() => doExport('xls')}>
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => doExport('csv')}>
              <FileText className="h-4 w-4" /> CSV
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Year">
              <select className={selectCls} value={yearId} onChange={(e) => setYearId(e.target.value)}>
                {(years?.data ?? []).map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Term">
              <select className={selectCls} value={termId} onChange={(e) => setTermId(e.target.value)}>
                {termsForYear.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Optional fee" required>
              <select className={selectCls} value={feeCategoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Select…</option>
                {optionalCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Class">
              <select className={selectCls} value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">All classes</option>
                {(classes?.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Student">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Choose a student"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </Field>
          </div>

          {optionalCats.length === 0 && (
            <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                No optional fee categories exist yet. Create one on{' '}
                <Link className="underline" to="/school/fees/categories">
                  Fees Categories
                </Link>{' '}
                with type <strong>Optional</strong>.
              </span>
            </div>
          )}

          {feeCategoryId && (
            <p className="text-sm">
              Set or update <span className="font-semibold text-primary">{roster?.category?.name ?? '…'}</span> optional
              fee amounts for the year{' '}
              <span className="font-semibold text-primary">
                {yearName} {termName}
              </span>
              .
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={applyToAll} disabled={rows.length === 0}>
              Apply first amount to all shown
            </Button>
            <Button variant="outline" size="sm" onClick={clearAll} disabled={rows.length === 0}>
              <X className="h-4 w-4" /> Clear all shown
            </Button>
            <Badge variant="secondary">
              {assigned.length} assigned
              {overrides.length > 0 && ` · ${money(overrideTotal)} across ${overrides.length} custom amount(s)`}
            </Badge>
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="w-24 text-center">Assigned</TableHead>
                  <TableHead className="w-40">Current amount</TableHead>
                  <TableHead className="w-56">Enter / Update Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!termId || !feeCategoryId) && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      Choose a term and an optional fee to load students.
                    </TableCell>
                  </TableRow>
                )}
                {termId && feeCategoryId && isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                )}
                {termId && feeCategoryId && !isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No active students match these filters.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r, i) => {
                  const st = stateOf(r);
                  const changed = !!edits[r.studentProfileId];
                  return (
                    <TableRow key={r.studentProfileId} className={changed ? 'bg-primary/5' : undefined}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-muted-foreground">{r.admissionNo}</div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.className}</TableCell>
                      <TableCell className="text-center">
                        <input
                          type="checkbox"
                          checked={st.optedIn}
                          onChange={(e) => setEdit(r, { optedIn: e.target.checked })}
                          title="Bill this student for the fee"
                        />
                      </TableCell>
                      <TableCell>
                        {r.optedIn ? (
                          <span className="font-medium">
                            {r.amount != null ? money(r.amount) : 'Structure amount'}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Not assigned</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={0}
                            placeholder="Enter amount E.g. 100,000"
                            value={st.amount}
                            onChange={(e) => onAmount(r, e.target.value)}
                          />
                          <Button variant="ghost" size="sm" onClick={() => clearRow(r)} title="Clear / unassign">
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            Leave an amount blank but keep <strong>Assigned</strong> ticked to charge the amount set on the fee
            structure. Unticking a student removes the fee from their next invoice.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
