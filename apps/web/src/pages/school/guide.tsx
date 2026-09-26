import { Link } from 'react-router-dom';
import { ArrowRight, CalendarRange, HelpCircle, UserRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useTerminology } from '@/features/school/api';
import { useAuthStore } from '@/stores/auth.store';
import { SetupChecklist } from './_components/SetupChecklist';

interface Task {
  label: string;
  to: string;
}

interface RoleGuide {
  role: string;
  /** Shown first when the signed-in user holds this permission. */
  permission: string;
  summary: string;
  tasks: Task[];
}

/**
 * "How the system works" — one page that explains the school's year, who does
 * what, and where to click, in plain words. Linked from the dashboard checklist
 * and the menu. Every link goes to the real screen that does the job.
 */
export function SchoolGuidePage() {
  const t = useTerminology();
  const has = useAuthStore((s) => s.hasPermission);
  const stream = t.section.toLowerCase();

  const roles: RoleGuide[] = [
    {
      role: 'Administrator / Head Teacher',
      permission: 'school:academicyear:lifecycle',
      summary: 'Sets the school up, opens and closes the year, approves marks, refunds and write-offs.',
      tasks: [
        { label: 'Academic years and terms', to: '/school/management/academic-years' },
        { label: `Classes and ${t.sectionPlural.toLowerCase()}`, to: '/school/management/classes' },
        { label: 'Staff and their logins', to: '/school/staff' },
        { label: 'Approve marks and results', to: '/school/approvals' },
        { label: 'School settings and wording', to: '/school/management/settings' },
      ],
    },
    {
      role: 'Registrar / Admissions',
      permission: 'school:admissions:write',
      summary: 'Takes applications, admits pupils, places them in a class, and handles transfers and leavers.',
      tasks: [
        { label: 'Applications', to: '/school/admissions' },
        { label: 'Pupils (register and place)', to: '/school/students' },
        { label: `Class placement and ${stream} changes`, to: '/school/enrollment' },
        { label: 'Parent portal accounts', to: '/school/portals' },
      ],
    },
    {
      role: 'Bursar',
      permission: 'school:fees:collect',
      summary: 'Sets fees, bills each term, records payments and issues receipts. Refunds go to the Head Teacher to approve.',
      tasks: [
        { label: 'Fee structures', to: '/school/fees/structures' },
        { label: 'Record a payment', to: '/school/fees/collect' },
        { label: 'Balances and statements', to: '/school/fees' },
      ],
    },
    {
      role: 'Teacher',
      permission: 'school:attendance:own',
      summary: 'Takes the register and enters marks for the classes assigned to you. You only see your own classes.',
      tasks: [
        { label: 'Take attendance', to: '/school/attendance' },
        { label: 'Enter marks', to: '/school/enter-marks' },
        { label: 'My timetable', to: '/school/timetable' },
      ],
    },
  ];
  const mine = roles.filter((r) => has(r.permission));
  const ordered = [...mine, ...roles.filter((r) => !mine.includes(r))];

  const year: Array<{ when: string; steps: Task[] }> = [
    {
      when: 'Before the year starts',
      steps: [
        { label: 'Create the academic year and its three terms', to: '/school/management/academic-years' },
        { label: `Add ${t.sectionPlural.toLowerCase()} where a class is split`, to: '/school/management/classes' },
        { label: 'Set each term’s fees', to: '/school/fees/structures' },
        { label: 'Assign teachers to classes and subjects', to: '/school/timetable' },
      ],
    },
    {
      when: 'Start of each term',
      steps: [
        { label: 'Make the new term current', to: '/school/management/terms' },
        { label: 'Admit and place new pupils', to: '/school/students' },
        { label: 'Bill the term (invoices go to every placed pupil)', to: '/school/fees' },
      ],
    },
    {
      when: 'Every day',
      steps: [
        { label: 'Teachers take the register', to: '/school/attendance' },
        { label: 'Bursar records payments — a receipt is issued each time', to: '/school/fees/collect' },
      ],
    },
    {
      when: 'End of term',
      steps: [
        { label: 'Teachers enter and submit marks', to: '/school/enter-marks' },
        { label: 'Head Teacher approves marks and publishes report cards', to: '/school/approvals' },
      ],
    },
    {
      when: 'End of the year',
      steps: [
        { label: 'Promote pupils to the next class (P7 graduate)', to: '/school/promotion' },
        { label: 'Close the year — its records become read-only', to: '/school/management/academic-years' },
      ],
    },
  ];

  const faq: Array<{ q: string; a: string; to?: string }> = [
    {
      q: `A pupil moves to another ${stream} or class`,
      a: 'Open the pupil, choose "Move". Their old class stays in their history.',
      to: '/school/enrollment',
    },
    {
      q: 'A pupil leaves the school',
      a: 'Open the pupil and withdraw or transfer them with a date. Nothing is deleted; their fees and results stay on record.',
      to: '/school/students',
    },
    {
      q: 'A payment was recorded against the wrong pupil',
      a: 'Reverse the payment (it needs a reason and approval), then record it again on the right pupil.',
      to: '/school/fees',
    },
    {
      q: 'A parent overpaid or needs a refund',
      a: 'The Bursar requests the refund; the Head Teacher approves it. The same person cannot do both.',
      to: '/school/fees',
    },
    {
      q: 'Parents are not receiving SMS',
      a: 'Connect an SMS gateway under Communication → Channels. Until one is connected, messages are recorded as not sent.',
      to: '/communication/channels',
    },
    {
      q: 'A teacher cannot see their class',
      a: 'The teacher needs a login linked to their staff record, and an assignment to that class and subject.',
      to: '/school/staff',
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">How the system works</h1>
        <p className="text-sm text-muted-foreground">
          The school year in five stages, who does what, and answers to everyday questions. Every link opens the
          screen that does the job.
        </p>
      </div>

      <SetupChecklist />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange className="h-4 w-4" /> The school year, step by step
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {year.map((stage, i) => (
            <div key={stage.when} className="rounded-md border p-3">
              <p className="mb-2 text-sm font-semibold">
                <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                  {i + 1}
                </span>
                {stage.when}
              </p>
              <ul className="space-y-1.5">
                {stage.steps.map((s) => (
                  <li key={s.label}>
                    <Link to={s.to} className="group inline-flex items-start gap-1 text-sm hover:underline">
                      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                      {s.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRound className="h-4 w-4" /> Who does what
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {ordered.map((r) => (
            <div key={r.role} className="rounded-md border p-3">
              <div className="mb-1 flex items-center gap-2">
                <p className="text-sm font-semibold">{r.role}</p>
                {mine.includes(r) && <Badge variant="secondary">Your role</Badge>}
              </div>
              <p className="mb-2 text-xs text-muted-foreground">{r.summary}</p>
              <ul className="space-y-1">
                {r.tasks.map((task) => (
                  <li key={task.label}>
                    <Link to={task.to} className="text-sm text-primary hover:underline">
                      {task.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HelpCircle className="h-4 w-4" /> Common questions
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {faq.map((f) => (
            <div key={f.q} className="py-3">
              <p className="text-sm font-medium">{f.q}</p>
              <p className="text-sm text-muted-foreground">
                {f.a}{' '}
                {f.to && (
                  <Link to={f.to} className="text-primary hover:underline">
                    Open
                  </Link>
                )}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
