import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

export interface SetupStep {
  id: string;
  title: string;
  /** One plain sentence: what this is and why the school needs it. */
  why: string;
  done: boolean;
  /** What was found, e.g. "2026 is current · Term 3". */
  detail: string | null;
  /** Web route that does this step. */
  href: string;
  /** The role that normally does it. */
  who: string;
}

/**
 * "Is this school ready to run?" — a checklist computed from real data.
 *
 * A new school opened the app to an empty dashboard and ninety menu items with
 * nothing saying where to start or what order things must happen in (a term
 * before fees, classes before placing pupils, a gateway before parents hear
 * anything). Every step here is read from the records that make it true, so
 * the checklist can never say "done" for something that is not.
 */
@Injectable()
export class SetupStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  async status(): Promise<{ steps: SetupStep[]; done: number; total: number; ready: boolean }> {
    const db = this.prisma.client as any;
    const organizationId = this.tenant.organizationId;

    const [profile, year, term, classes, subjects, staffUsers, staff, assignments, smsChannels, portalAccounts] =
      await Promise.all([
        db.schoolProfile.findFirst({ select: { phone: true, email: true, address: true } }),
        db.academicYear.findFirst({ where: { isCurrent: true, deletedAt: null }, select: { id: true, name: true, status: true } }),
        db.term.findFirst({ where: { isCurrent: true, deletedAt: null }, select: { id: true, name: true } }),
        db.schoolClass.count(),
        db.subject.count({ where: { isActive: true } }),
        // People other than the first administrator who can sign in.
        this.prisma.raw.user.count({ where: { organizationId, isActive: true } }),
        db.staffProfile.count({ where: { status: 'active' } }),
        db.teacherAssignment.count(),
        db.communicationChannel.count({ where: { providerId: 'sms', disabledAt: null } }),
        db.portalIdentity.count({ where: { revokedAt: null } }),
      ]);

    const [feeSchedules, enrolled] = await Promise.all([
      term ? db.feeSchedule.count({ where: { termId: term.id } }) : Promise.resolve(0),
      year ? db.studentEnrollment.count({ where: { academicYearId: year.id, status: 'ACTIVE' } }) : Promise.resolve(0),
    ]);
    const smsReady = smsChannels > 0 || Boolean(process.env.TWILIO_ACCOUNT_SID);
    const emailReady = Boolean(process.env.SMTP_HOST);

    const steps: SetupStep[] = [
      {
        id: 'profile',
        title: 'Add your school details',
        why: 'Your phone, email and address appear on receipts, report cards and messages to parents.',
        done: Boolean(profile?.phone && (profile?.email || profile?.address)),
        detail: profile?.phone ?? null,
        href: '/school/management/settings',
        who: 'Administrator',
      },
      {
        id: 'year',
        title: 'Create this academic year and make it current',
        why: 'Every enrollment, mark, attendance day and fee belongs to a year.',
        done: Boolean(year && year.status === 'ACTIVE'),
        detail: year ? `${year.name} (${String(year.status).toLowerCase()})` : null,
        href: '/school/management/academic-years',
        who: 'Administrator / Head Teacher',
      },
      {
        id: 'term',
        title: 'Add the terms and set the current term',
        why: 'Fees are billed, pupils placed and registers taken per term.',
        done: Boolean(term),
        detail: term?.name ?? null,
        href: '/school/management/terms',
        who: 'Administrator',
      },
      {
        id: 'classes',
        title: 'Check your classes and streams',
        why: 'Baby, Middle, Top and P1–P7 are created for you. Add streams (e.g. North, South) where a class is split.',
        done: classes > 0,
        detail: classes ? `${classes} classes` : null,
        href: '/school/management/classes',
        who: 'Administrator',
      },
      {
        id: 'subjects',
        title: 'Add the subjects you teach',
        why: 'Marks, report cards and the timetable are organised by subject.',
        done: subjects > 0,
        detail: subjects ? `${subjects} subjects` : null,
        href: '/school/management/subjects',
        who: 'Head Teacher / Deputy',
      },
      {
        id: 'staff',
        title: 'Add staff and give them a login',
        why: 'Teachers, the bursar and the registrar each sign in with their own account and role.',
        done: staff > 0 && staffUsers > 1,
        detail: staff ? `${staff} staff · ${staffUsers} logins` : null,
        href: '/school/staff',
        who: 'Administrator',
      },
      {
        id: 'teaching',
        title: 'Assign teachers to classes and subjects',
        why: 'A teacher only sees, marks and takes the register for the classes they are assigned.',
        done: assignments > 0,
        detail: assignments ? `${assignments} assignments` : null,
        href: '/school/timetable',
        who: 'Deputy Head',
      },
      {
        id: 'fees',
        title: 'Set the fees for the current term',
        why: 'Without a fee structure for the term, no invoices can be raised and no balances shown.',
        done: feeSchedules > 0,
        detail: feeSchedules ? `${feeSchedules} fee schedule(s) for ${term?.name ?? 'this term'}` : null,
        href: '/school/fees/structures',
        who: 'Bursar',
      },
      {
        id: 'students',
        title: 'Admit and place your pupils',
        why: 'A pupil appears on registers, mark sheets and fee lists once placed in a class for the year.',
        done: enrolled > 0,
        detail: enrolled ? `${enrolled} pupils enrolled` : null,
        href: '/school/students',
        who: 'Registrar',
      },
      {
        id: 'messages',
        title: 'Connect SMS (and email) for parents',
        why: 'Fee, attendance and admission messages to parents need an SMS gateway; until then they are not sent.',
        done: smsReady,
        detail: [smsReady ? 'SMS ready' : null, emailReady ? 'email ready' : null].filter(Boolean).join(' · ') || null,
        href: '/communication/channels',
        who: 'Administrator',
      },
      {
        id: 'portal',
        title: 'Invite parents to the portal',
        why: 'Parents see their own children’s fees, results and attendance from their phone.',
        done: portalAccounts > 0,
        detail: portalAccounts ? `${portalAccounts} family accounts` : null,
        href: '/school/portals',
        who: 'Registrar',
      },
    ];

    const done = steps.filter((s) => s.done).length;
    // "Ready" = the steps without which daily school work cannot happen.
    const essential = new Set(['year', 'term', 'classes', 'staff', 'fees', 'students']);
    const ready = steps.filter((s) => essential.has(s.id)).every((s) => s.done);
    return { steps, done, total: steps.length, ready };
  }
}
