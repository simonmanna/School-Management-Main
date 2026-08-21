import { useState } from 'react';
import { Plus, CalendarClock } from 'lucide-react';
import {
  useFeeStructures,
  useFeeSchedules,
  useTerms,
  useCreateFeeSchedule,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';
import { sel } from './fees-shared';

export function SchoolFeeSchedulesPage() {
  const { data: structures } = useFeeStructures();
  const { data: schedules } = useFeeSchedules();
  const { data: terms } = useTerms();
  const createSchedule = useCreateFeeSchedule();

  const [structId, setStructId] = useState('');
  const [termId, setTermId] = useState('');
  const [due, setDue] = useState('');

  const save = async () => {
    try {
      await createSchedule.mutateAsync({ feeStructureId: structId, termId, dueDate: due });
      notify.success('Schedule created — the structure now applies to that term');
      setStructId('');
      setTermId('');
      setDue('');
    } catch {
      notify.error('Could not create schedule');
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Fee Schedules</h1>
        <p className="text-sm text-muted-foreground">
          A schedule attaches a fee structure to a term with a due date and (optional) late-fee policy. Each scheduled
          structure generates student invoices when you run billing for that term.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Schedule a structure to a term</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <select className={sel} value={structId} onChange={(e) => setStructId(e.target.value)}>
              <option value="">Fee structure…</option>
              {(structures?.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <select className={sel} value={termId} onChange={(e) => setTermId(e.target.value)}>
                <option value="">Term…</option>
                {(terms?.data ?? []).map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isCurrent ? ' (current)' : ''}
                  </option>
                ))}
              </select>
              <input type="date" className={sel} value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <Button onClick={save} disabled={!structId || !termId || !due || createSchedule.isPending}>
              <Plus className="h-4 w-4" /> Create schedule
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" /> Scheduled structures
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(schedules?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Structure</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(schedules?.data ?? []).map((sc) => (
                  <TableRow key={sc.id}>
                    <TableCell className="font-medium">{sc.feeStructure?.name ?? sc.feeStructureId}</TableCell>
                    <TableCell>
                      {(terms?.data ?? []).find((t: any) => t.id === sc.termId)?.name ?? sc.termId}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{sc.dueDate.slice(0, 10)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
