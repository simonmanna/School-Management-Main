import { useMemo, useState } from 'react';
import { Printer, FileSpreadsheet, FileText } from 'lucide-react';
import { useAcademicYears, useTerms, useEnrollmentSummary, type Term, type AcademicYear } from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';

function toCsv(rows: any[], totals: any): string {
  const header = ['Class', 'Male', 'Female', 'Male Boarding', 'Female Boarding', 'Male Day', 'Female Day', 'Total'];
  const body = rows.map((r) => [r.className, r.male, r.female, r.maleBoarding, r.femaleBoarding, r.maleDay, r.femaleDay, r.total]);
  const t = ['TOTAL', totals.male, totals.female, totals.maleBoarding, totals.femaleBoarding, totals.maleDay, totals.femaleDay, totals.total];
  return [header, ...body, t].map((line) => line.join(',')).join('\n');
}

export function SchoolEnrollmentSummaryPage() {
  const { data: years } = useAcademicYears();
  const { data: terms } = useTerms();
  const yearList: AcademicYear[] = useMemo(() => (years?.data ?? []), [years]);
  const termList: Term[] = useMemo(() => (terms?.data ?? []), [terms]);

  const [yearId, setYearId] = useState('');
  const [termId, setTermId] = useState('');

  const termsForYear = useMemo(
    () => (yearId ? termList.filter((t) => t.academicYearId === yearId) : termList),
    [termId, termList, yearId],
  );

  const { data, isLoading } = useEnrollmentSummary(termId || undefined);
  const rows = data?.rows ?? [];
  const totals = data?.totals;

  const yearName = yearList.find((y) => y.id === yearId)?.name ?? '';
  const termName = termList.find((t) => t.id === termId)?.name ?? 'Current enrollment';

  const print = () => window.print();
  const dl = (name: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportCsv = () => dl(`enrollment-summary-${termName}.csv`, toCsv(rows, totals ?? {}), 'text/csv');
  const exportExcel = () => dl(`enrollment-summary-${termName}.csv`, toCsv(rows, totals ?? {}), 'application/vnd.ms-excel');

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Enrollment Summary Report</h1>
          <p className="text-sm text-muted-foreground">
            A summary of the enrollment status for {termName}
            {yearName ? ` · ${yearName}` : ''}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={print}><Printer className="h-4 w-4" /> Print</Button>
          <Button variant="outline" size="sm" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
          <Button variant="outline" size="sm" onClick={exportCsv}><FileText className="h-4 w-4" /> CSV</Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label className="text-xs">Academic Year</Label>
            <select className={sel} value={yearId} onChange={(e) => { setYearId(e.target.value); setTermId(''); }}>
              <option value="">All years</option>
              {yearList.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Term</Label>
            <select className={sel} value={termId} onChange={(e) => setTermId(e.target.value)}>
              <option value="">Current enrollment</option>
              {termsForYear.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Enrollment by class
            {totals ? ` · ${totals.total} student(s)` : ''}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Total number of students in each class, including male and female students, as well as boarding and day students.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Class</th>
                  <th className="px-3 py-2">Male</th>
                  <th className="px-3 py-2">Female</th>
                  <th className="px-3 py-2">Male Boarding</th>
                  <th className="px-3 py-2">Female Boarding</th>
                  <th className="px-3 py-2">Male Day</th>
                  <th className="px-3 py-2">Female Day</th>
                  <th className="px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.classId} className="border-b last:border-0">
                    <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{r.className}</td>
                    <td className="px-3 py-2">{r.male}</td>
                    <td className="px-3 py-2">{r.female}</td>
                    <td className="px-3 py-2">{r.maleBoarding}</td>
                    <td className="px-3 py-2">{r.femaleBoarding}</td>
                    <td className="px-3 py-2">{r.maleDay}</td>
                    <td className="px-3 py-2">{r.femaleDay}</td>
                    <td className="px-3 py-2 font-semibold">{r.total}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">No classes or students found.</td></tr>}
                {totals && (
                  <tr className="border-t-2 bg-muted/40 font-semibold">
                    <td className="px-3 py-2" colSpan={2}>Total</td>
                    <td className="px-3 py-2">{totals.male}</td>
                    <td className="px-3 py-2">{totals.female}</td>
                    <td className="px-3 py-2">{totals.maleBoarding}</td>
                    <td className="px-3 py-2">{totals.femaleBoarding}</td>
                    <td className="px-3 py-2">{totals.maleDay}</td>
                    <td className="px-3 py-2">{totals.femaleDay}</td>
                    <td className="px-3 py-2">{totals.total}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
