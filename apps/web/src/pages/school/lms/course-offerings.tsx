import { useState } from 'react';
import { BookCopy, Plus, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useTerms, useSubjects, useClasses, useSections, useAcademicYears } from '@/features/school/api';
import { useCourseOfferings, useCreateCourseOffering, useUpsertCourseOfferingFromTeacherAssignment } from '@/features/school/api';
import { notify } from '@/lib/notify';

const sel = 'rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolLmsCourseOfferingsPage() {
  const { data: offerings } = useCourseOfferings();
  const { data: terms } = useTerms();
  const { data: subjects } = useSubjects();
  const { data: classes } = useClasses();
  const { data: sections } = useSections();
  const { data: years } = useAcademicYears();
  const create = useCreateCourseOffering();
  const upsert = useUpsertCourseOfferingFromTeacherAssignment();

  const [form, setForm] = useState({ academicYearId: '', termId: '', subjectId: '', classId: '', sectionId: '', curriculumId: '' });
  const [taId, setTaId] = useState('');

  const name = (id?: string | null, list?: any[]) => list?.find((x) => x.id === id)?.name ?? '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BookCopy className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Course Offerings</h1>
        <Badge variant="outline">{offerings?.length ?? 0}</Badge>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Create / upsert offering</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div><Label>Academic Year</Label><select className={sel} value={form.academicYearId} onChange={(e) => setForm({ ...form, academicYearId: e.target.value })}>
            <option value="">—</option>{years?.data?.map((y: any) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></div>
          <div><Label>Term</Label><select className={sel} value={form.termId} onChange={(e) => setForm({ ...form, termId: e.target.value })}>
            <option value="">—</option>{terms?.data?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div><Label>Subject</Label><select className={sel} value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
            <option value="">—</option>{subjects?.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><Label>Class</Label><select className={sel} value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
            <option value="">—</option>{classes?.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><Label>Section</Label><select className={sel} value={form.sectionId} onChange={(e) => setForm({ ...form, sectionId: e.target.value })}>
            <option value="">—</option>{sections?.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><Label>Curriculum ID</Label><Input value={form.curriculumId} onChange={(e) => setForm({ ...form, curriculumId: e.target.value })} placeholder="curriculum uuid" /></div>
          <div className="col-span-2 md:col-span-3">
            <Button disabled={!form.academicYearId || !form.termId || !form.subjectId || !form.classId || create.isPending} onClick={async () => {
              try { await create.mutateAsync(form); notify.success('Course offering saved'); setForm({ academicYearId: '', termId: '', subjectId: '', classId: '', sectionId: '', curriculumId: '' }); } catch (e: any) { notify.error(e?.message ?? 'Failed'); }
            }}><Plus className="mr-1 h-4 w-4" />Create offering</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Idempotent from Teacher Assignment</CardTitle></CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="flex-1"><Label>Teacher Assignment ID</Label><Input value={taId} onChange={(e) => setTaId(e.target.value)} placeholder="teacher-assignment uuid" /></div>
          <Button disabled={!taId || upsert.isPending} onClick={async () => { try { await upsert.mutateAsync(taId); notify.success('Upserted (idempotent)'); setTaId(''); } catch (e: any) { notify.error(e?.message ?? 'Failed'); } }}><Repeat className="mr-1 h-4 w-4" />Upsert</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Offerings</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!offerings?.length && <p className="text-sm text-muted-foreground">No course offerings yet.</p>}
          {offerings?.map((o: any) => (
            <div key={o.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{name(o.subjectId, subjects?.data)}</span> · {name(o.classId, classes?.data)} {o.sectionId ? `(${name(o.sectionId, sections?.data)})` : ''}
                <span className="ml-2 text-muted-foreground">{name(o.termId, terms?.data)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{o.teacherPartnerIds?.length ?? 0} teacher(s)</Badge>
                <span className="text-xs text-muted-foreground">{o.id.slice(0, 8)}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
