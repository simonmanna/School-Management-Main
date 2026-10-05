/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Admissions & enrollment demo for one demo school. Driven by ./run.cjs, which
 * boots the compiled API and hands its services in.
 *
 * Environment:
 *   --school=<key>       sunrise | greenvalley
 *   DEMO_AS_OF           last story date (default: yesterday, capped at 2026-12-31)
 */
import { PrismaClient } from '@prisma/client';
import { SCHOOL, loadSchool, assertNotProduction, ok, warn } from '../shared';
import { buildContext, clock, iso, type OpsHost } from '../ops/kit';
import { seedAdmissions } from './19-admissions';

export async function runAdmissions(host: OpsHost): Promise<void> {
  assertNotProduction();
  const started = Date.now();
  clock.install();
  const prisma = new PrismaClient();
  try {
    console.log(`\n=== ${SCHOOL.orgName} — admissions & enrollment demo (FICTIONAL DATA) ===\n`);
    const school = await loadSchool(prisma);
    const asOf = storyEnd();
    const ctx = await buildContext(host, prisma, school, asOf);
    ok(`organization ${SCHOOL.orgCode}; the admissions story runs to ${asOf}`);

    await seedAdmissions(ctx);

    console.log('\n── Who to log in as ──');
    const d = SCHOOL.emailDomain;
    const pw = process.env.DEMO_STAFF_PASSWORD ?? SCHOOL.passwords.staff;
    const row = (email: string, role: string) => console.log(`  - ${email.padEnd(28)} ${role.padEnd(46)} ${pw}`);
    row(`registrar@${d}`, 'Registrar (applications, offers, enrolment)');
    row(`head@${d}`, 'Head Teacher (decisions, waivers, workflows)');
    row(`dos@${d}`, 'Director of Studies (screening, interviews, scoring)');
    row(`bursar@${d}`, 'Bursar (application fees)');

    console.log('\n── Where to look ──');
    for (const line of [
      'School → Admissions & Enrollment → Applications   the worklist, filterable by status',
      'School → Admissions & Enrollment → Analytics      funnel, source mix, processing time',
      'School → Admissions & Enrollment → Configuration  cycles, capacity, requirements, offer templates, enquiries',
      'School → Admissions & Enrollment → Workflow       the two workflows and what each stage requires',
      'Open any application                              timeline, guardians, documents, scores, offer, fee',
    ]) {
      console.log(`  - ${line}`);
    }

    console.log(`\nDEMO DATA — fictional school. Done in ${Math.round((Date.now() - started) / 1000)}s.\n`);
  } finally {
    clock.reset();
    await prisma.$disconnect();
  }
}

/** Yesterday (Kampala time), capped at the end of the 2026 school year. */
function storyEnd(): string {
  if (process.env.DEMO_AS_OF) return process.env.DEMO_AS_OF.slice(0, 10);
  const kampalaToday = iso(new Date(Date.now() + 3 * 3_600_000));
  const yesterday = iso(new Date(new Date(`${kampalaToday}T00:00:00Z`).getTime() - 86_400_000));
  if (yesterday > '2026-12-31') return '2026-12-31';
  if (yesterday < '2026-08-05') {
    warn('The 2027 intake opens in August 2026; before then the live cycles will look thin.');
  }
  return yesterday;
}
