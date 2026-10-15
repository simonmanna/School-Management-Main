import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import {
  useStudents, useTerms, useSubjects, useOutcomeAchievements, useTranscript,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const LEVEL_LABEL: Record<string, string> = { not_met: 'Not met', approaching: 'Approaching', met: 'Met', exceeded: 'Exceeded' };
const LEVEL_COLOR: Record<string, string> = { not_met: 'destructive', approaching: 'secondary', met: 'default', exceeded: 'default' };

export function SchoolCompetencyReportPage() {
  // Search the whole school: the picker used to load only the first 100 pupils,
  // so most of a 700-pupil school could not be reached (review A16).
  const [search, setSearch] = useState('');
  const { data: students } = useStudents({ pageSize: 50, ...(search.trim() ? { search: search.trim() } : {}) });
  const { data: terms } = useTerms();
  const [studentId, setStudentId] = useState('');
  const [termId, setTermId] = useState('');
  const { data: achievements } = useOutcomeAchievements(studentId || undefined, termId || undefined);
  const { data: transcript } = useTranscript(studentId || undefined);
  const { data: subjects } = useSubjects();
  const termName = (id: string) => (terms?.data ?? []).find((t: any) => t.id === id)?.name ?? 'Term';
  const subjectName = (id: string) => (subjects?.data ?? []).find((x: any) => x.id === id)?.name ?? '—';
  const transcriptTerms: any[] = (transcript as any)?.payload?.terms ?? [];

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Competency &amp; Annual</h1>
        <p className="text-sm text-muted-foreground">A pupil's learning outcomes for a term, and their results across every term for annual reporting.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs" htmlFor="cr-search">Find a pupil</label>
          <input id="cr-search" className="w-56 rounded-md border bg-card px-3 py-2 text-sm" placeholder="Name or admission no." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="min-w-64 space-y-1">
          <label className="text-xs">Student</label>
          <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select…</option>{(students?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs">Term</label>
          <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={termId} onChange={(e) => setTermId(e.target.value)}>
            <option value="">Select…</option>{(terms?.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.label ?? t.name}</option>)}
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
            {transcriptTerms.length > 0 ? (
              <div className="space-y-3">
                {(transcript as any)?.payload?.cumulativeGpa != null && (
                  <p className="text-sm">Overall GPA: <span className="font-semibold">{(transcript as any).payload.cumulativeGpa}</span></p>
                )}
                {transcriptTerms.map((t) => (
                  <div key={t.termId} className="rounded border p-2 text-sm">
                    <p className="font-medium">
                      {termName(t.termId)}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {t.meanPercent != null ? `average ${t.meanPercent}%` : ''}
                        {t.classRank != null ? ` · position ${t.classRank}` : ''}
                        {t.division ? ` · division ${t.division}` : ''}
                        {t.aggregate != null ? ` · aggregate ${t.aggregate}` : ''}
                      </span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {(t.subjects ?? []).map((sub: any) => (
                        <Badge key={sub.subjectId} variant="secondary">
                          {subjectName(sub.subjectId)}: {sub.grade ?? '—'}{sub.finalPercent != null ? ` (${sub.finalPercent}%)` : ''}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No transcript built yet. Build one on <Link to="/school/certification" className="underline">Certificates &amp; Transcripts</Link>.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
