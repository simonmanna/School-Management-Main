import { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import {
  useStudents, useTerms, useOutcomeAchievements, useTranscript,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const LEVEL_LABEL: Record<string, string> = { not_met: 'Not met', approaching: 'Approaching', met: 'Met', exceeded: 'Exceeded' };
const LEVEL_COLOR: Record<string, string> = { not_met: 'destructive', approaching: 'secondary', met: 'default', exceeded: 'default' };

export function SchoolCompetencyReportPage() {
  const { data: students } = useStudents({ pageSize: 100 });
  const { data: terms } = useTerms();
  const [studentId, setStudentId] = useState('');
  const [termId, setTermId] = useState('');
  const { data: achievements } = useOutcomeAchievements(studentId || undefined, termId || undefined);
  const { data: transcript } = useTranscript(studentId || undefined);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Competency & Annual Reports</h1>
        <p className="text-sm text-muted-foreground">P2-B: competency outcomes per student (CBC strands) plus the cumulative transcript for annual reporting.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 space-y-1">
          <label className="text-xs">Student</label>
          <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select…</option>{(students?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs">Term</label>
          <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={termId} onChange={(e) => setTermId(e.target.value)}>
            <option value="">Select…</option>{(terms?.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {studentId && termId && (
        <Card>
          <CardHeader><CardTitle className="text-base">Competency outcomes — {terms?.data?.find((t: any) => t.id === termId)?.name}</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {(achievements ?? []).map((a: any) => (
              <div key={a.id} className="flex items-center justify-between rounded border p-2 text-sm">
                <span className="flex-1">{a.learningOutcome?.title ?? 'Outcome'}</span>
                {a.learningOutcome?.competency?.code && <span className="text-xs text-muted-foreground mr-2">{a.learningOutcome.competency.code}</span>}
                <Badge variant={LEVEL_COLOR[a.level] as any}>{LEVEL_LABEL[a.level] ?? a.level}</Badge>
              </div>
            ))}
            {(achievements ?? []).length === 0 && <p className="text-sm text-muted-foreground">No outcomes recorded for this term yet.</p>}
          </CardContent>
        </Card>
      )}

      {studentId && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><GraduationCap className="h-4 w-4" /> Cumulative transcript (annual)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {((transcript as any)?.payload?.terms ?? []).length > 0 ? (
              <pre className="max-h-96 overflow-auto rounded bg-muted/40 p-3 text-xs">{JSON.stringify((transcript as any).payload, null, 2)}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">No cumulative transcript built yet. Build one from the Certification page.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
