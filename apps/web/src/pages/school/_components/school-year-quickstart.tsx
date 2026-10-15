import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

/**
 * Set up a Ugandan school year in one step (review A19, Phase 2.1): the
 * calendar-year academic year and its three terms, with typical term dates
 * pre-filled for the school to correct against this year's Ministry calendar.
 * Uses the same year and term endpoints as the forms below it.
 */
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** First Monday on or after the given date. */
function firstMonday(y: number, m: number, d: number): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function defaultsFor(year: number) {
  return [
    { name: 'Term 1', startDate: firstMonday(year, 2, 1), endDate: iso(year, 5, 2) },
    { name: 'Term 2', startDate: firstMonday(year, 5, 25), endDate: iso(year, 8, 22) },
    { name: 'Term 3', startDate: firstMonday(year, 9, 12), endDate: iso(year, 12, 5) },
  ];
}

export function SchoolYearQuickStart() {
  const qc = useQueryClient();
  const nextYear = new Date().getMonth() >= 8 ? new Date().getFullYear() + 1 : new Date().getFullYear();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(String(nextYear));
  const [makeCurrent, setMakeCurrent] = useState(false);
  const [terms, setTerms] = useState(defaultsFor(nextYear));
  const [saving, setSaving] = useState(false);

  const y = Number(year);
  const problems = useMemo(() => {
    const out: string[] = [];
    if (!Number.isInteger(y) || y < 2000 || y > 2100) out.push('Enter the year, e.g. 2027.');
    terms.forEach((t, i) => {
      if (!t.startDate || !t.endDate || t.endDate < t.startDate) out.push(`${t.name}: the end date must be after the start date.`);
      if (i > 0 && t.startDate <= terms[i - 1].endDate) out.push(`${t.name} must start after ${terms[i - 1].name} ends.`);
    });
    return out;
  }, [y, terms]);

  const changeYear = (v: string) => {
    setYear(v);
    const n = Number(v);
    if (Number.isInteger(n) && n >= 2000 && n <= 2100) setTerms(defaultsFor(n));
  };

  const create = async () => {
    if (problems.length) return;
    setSaving(true);
    try {
      const created = (await api.post('/school/academic-years', {
        name: String(y),
        startDate: iso(y, 1, 1),
        endDate: iso(y, 12, 31),
        isCurrent: makeCurrent,
      })).data;
      for (const [i, t] of terms.entries()) {
        await api.post('/school/terms', {
          academicYearId: created.id,
          name: t.name,
          startDate: t.startDate,
          endDate: t.endDate,
          isCurrent: makeCurrent && i === 0,
        });
      }
      notify.success(`${y} and its three terms are set up`, {
        description: makeCurrent ? 'Term 1 is the current term.' : 'Activate the year and set the current term when it starts.',
      });
      qc.invalidateQueries({ queryKey: ['school', 'academic-years'] });
      qc.invalidateQueries({ queryKey: ['school', 'terms'] });
      setOpen(false);
    } catch (e: any) {
      notify.error('Could not set up the year', { description: e?.response?.data?.message ?? 'Try again.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <CalendarPlus className="h-4 w-4" /> Set up a school year
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set up a school year</DialogTitle>
            <DialogDescription>
              The calendar year and its three terms. The dates are typical for Uganda — check them against this year’s
              school calendar before saving.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="qs-year">Year</Label>
                <Input id="qs-year" inputMode="numeric" value={year} onChange={(e) => changeYear(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" checked={makeCurrent} onChange={(e) => setMakeCurrent(e.target.checked)} />
                Make it the current year (Term 1 current)
              </label>
            </div>
            {terms.map((t, i) => (
              <div key={t.name} className="grid grid-cols-[80px_1fr_1fr] items-center gap-2">
                <span className="text-sm font-medium">{t.name}</span>
                <Input type="date" aria-label={`${t.name} starts`} value={t.startDate}
                  onChange={(e) => setTerms((all) => all.map((x, j) => (j === i ? { ...x, startDate: e.target.value } : x)))} />
                <Input type="date" aria-label={`${t.name} ends`} value={t.endDate}
                  onChange={(e) => setTerms((all) => all.map((x, j) => (j === i ? { ...x, endDate: e.target.value } : x)))} />
              </div>
            ))}
            {problems.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!!problems.length || saving} onClick={() => void create()}>{saving ? 'Setting up…' : 'Create year and terms'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
