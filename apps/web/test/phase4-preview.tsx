// Development-only interaction fixture. Synthetic learners; no backend credentials.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../src/lib/api';
import { ProductionMarkbook } from '../src/pages/school/_components/production-markbook';
import { CreateAssessmentDialog } from '../src/pages/school/_components/assessment-form';
import { useAuthStore } from '../src/stores/auth.store';
import { Toaster } from '../src/components/ui/toaster';
import '../src/index.css';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
useAuthStore.persist.setOptions({ name: 'phase4-interaction-fixture-auth' });
useAuthStore.setState({ accessToken: null, refreshToken: null, user: { id: 'fixture-user', email: 'fixture@example.test', firstName: 'Teacher', lastName: null, roles: [] }, organization: { id: 'fixture-org', name: 'Verification school', code: 'QA', currencyCode: 'UGX', timezone: 'Africa/Kampala' }, permissions: ['*'] });
let loseReply = false;
const sheet: any = { assessment: { id: 'fixture-assessment', title: 'Algebra — CAT 1', kind: 'cat', maxScore: 20, status: 'published', version: 1, locked: false, rosterFrozen: true, rosterId: 'r1', courseOfferingId: 'c1', courseName: 'S2 Mathematics', subject: { id: 'subject', name: 'Mathematics' }, class: { id: 'class', name: 'S2' } }, total: 3, marked: 0, approvalStatus: 'draft', students: ['Aine Grace', 'Byaruhanga Peter', 'Candiru Mary'].map((name, i) => ({ studentProfileId: `student-${i}`, name, admissionNo: `S2-00${i+1}`, studentAssessmentId: `sa-${i}`, marks: null, percentage: null, participation: 'missing', approvalStatus: 'draft', version: 0, comment: '', rejectionReason: null })) };
const responses = new Map();
api.defaults.adapter = async (config: any) => {
  const url = config.url; let data: any = { data: [] };
  if (url.endsWith('/marks')) {
    const key = config.headers['Idempotency-Key']; const body = JSON.parse(config.data);
    if (responses.has(key)) data = responses.get(key);
    else {
      const conflicts = body.rows.flatMap((r: any) => { const current = sheet.students.find((s: any) => s.studentProfileId === r.studentProfileId); return current.version !== r.expectedVersion ? [current] : []; });
      if (conflicts.length) throw { response: { status: 409, data: { code: 'MARK_VERSION_CONFLICT', conflicts } }, config };
      data = { saved: body.rows.length, savedAt: new Date().toISOString(), rows: body.rows.map((r: any) => ({ ...r, version: r.expectedVersion + 2, approvalStatus: 'draft' })) };
      sheet.students = sheet.students.map((s: any) => ({ ...s, ...(data.rows.find((r: any) => r.studentProfileId === s.studentProfileId) ?? {}) }));
      responses.set(key, data);
      if (loseReply) { loseReply = false; throw new Error('Simulated lost reply after server commit'); }
    }
  } else if (url === '/school/course-offerings') data = [{ id: 'c1', name: 'S2 Mathematics', status: 'ACTIVE', classId: 'class', subjectId: 'subject', termId: 'term', teachers: [], _count: { courseEnrollments: 3 } }];
  else if (url.includes('assessment-board')) data = { rows: [], policy: null };
  else if (url.includes('coverage')) data = { outcomes: [], summary: {} };
  else if (url.includes('rosters')) data = { data: [{ id: 'r1', name: 'S2 Mathematics — frozen snapshot', termId: 'term', classId: 'class', subjectId: 'subject', frozenAt: new Date().toISOString(), memberCount: 3 }] };
  return { data, status: 200, statusText: 'OK', headers: {}, config };
};
function Fixture() {
  const [revision, setRevision] = useState(0); const [wizard, setWizard] = useState(false); const [submitted, setSubmitted] = useState(false);
  return <main className="mx-auto max-w-6xl space-y-5 p-6"><header><p className="text-xs uppercase tracking-wider text-muted-foreground">Synthetic interaction fixture — no live records</p><h1 className="mt-2 text-2xl font-semibold">S2 Mathematics · CAT 1</h1><p className="text-sm text-muted-foreground">Frozen roster · 3 learners · 20 points</p></header><div className="flex gap-4 text-sm"><button className="underline" onClick={() => setWizard(true)}>Preview creation wizard</button><button className="underline" onClick={() => { loseReply = true; }}>Lose next save reply</button><button className="underline" onClick={() => { sheet.students[0] = { ...sheet.students[0], marks: 12, participation: 'present', version: sheet.students[0].version + 1 }; }}>Simulate another marker</button></div><ProductionMarkbook sheet={{ ...sheet }} onSaved={() => setRevision(revision + 1)} submitting={false} onSubmit={async () => setSubmitted(true)} onEvidence={() => {}} />{submitted && <p role="status">Submission requested after explicit save</p>}{wizard && <CreateAssessmentDialog termId="term" onClose={() => setWizard(false)} />}<Toaster /></main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><MemoryRouter><Fixture /></MemoryRouter></QueryClientProvider>);
