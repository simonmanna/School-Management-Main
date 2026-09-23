import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { normalizeE164 } from '../providers/sms/sms-gateway.config';
import { PlacementLookupService } from '../../school/enrollment/placement-lookup.service';
import {
  describeSelector,
  parseAudienceSelector,
  type AudienceSelector,
} from './audience-selector';

/**
 * Turns an AudienceSelector into concrete, reachable people.
 *
 * Runs against `prisma.raw` with an explicit organizationId, because the hot
 * caller (broadcast materialization) executes on a worker outside any request.
 *
 * Three properties this must hold, all of them learned from how school
 * broadcasts actually go wrong:
 *
 *  1. Resolution happens at SEND time. A frozen contact list silently excludes
 *     the student who enrolled this morning and keeps mailing the one who left.
 *  2. A person is counted ONCE per address in per_recipient mode. A parent of
 *     three children in the same class must not get — and be charged for —
 *     three identical SMS.
 *  3. Unreachable people are reported, never dropped. "Sent to 380" when the
 *     class has 400 is a number nobody questions; "380 sent, 20 have no phone
 *     number on file" is a task for the registrar.
 */

export interface AudienceMember {
  /** guardian | student | staff. */
  kind: 'guardian' | 'student' | 'staff';
  /** contact | student_profile | staff_profile — the backlink's table. */
  subjectType: string;
  subjectId: string;
  displayName: string;
  /** Normalized E.164, or null when the roster has no usable number. */
  phone: string | null;
  email: string | null;
  /** Login account, where one exists — the address for the internal transport. */
  userId: string | null;
  /** Template context: the child this message concerns (guardian rows). */
  studentProfileId: string | null;
  studentName: string | null;
  className: string | null;
  relationship: string | null;
}

export interface AudienceResolution {
  members: AudienceMember[];
  /** Matched people with no usable address on ANY transport. */
  unreachable: AudienceMember[];
  counts: {
    students: number;
    members: number;
    reachableByPhone: number;
    reachableByUser: number;
    unreachable: number;
  };
  description: string;
}

/** `IN` list chunk size — keeps a whole-school query off the parameter limit. */
const CHUNK = 500;

function chunk<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

@Injectable()
export class AudienceResolverService {
  private readonly logger = new Logger('AudienceResolver');

  constructor(
    private readonly prisma: PrismaService,
    private readonly placements: PlacementLookupService,
  ) {}

  async resolve(
    organizationId: string,
    rawSelector: AudienceSelector,
    defaultCountryCode?: string,
  ): Promise<AudienceResolution> {
    const selector = parseAudienceSelector(rawSelector);
    const cc = defaultCountryCode ?? process.env.SMS_DEFAULT_COUNTRY_CODE;

    const members =
      selector.scope === 'staff' || selector.scope === 'department'
        ? await this.resolveStaff(organizationId, selector, cc)
        : await this.resolveStudentDerived(organizationId, selector, cc);

    const deduped = this.dedupe(members, selector.dedupe);
    const reachable = deduped.filter((m) => m.phone || m.userId);
    const unreachable = deduped.filter((m) => !m.phone && !m.userId);
    const studentIds = new Set(deduped.map((m) => m.studentProfileId).filter(Boolean));

    return {
      members: reachable,
      unreachable,
      counts: {
        students: studentIds.size,
        members: deduped.length,
        reachableByPhone: reachable.filter((m) => m.phone).length,
        reachableByUser: reachable.filter((m) => m.userId).length,
        unreachable: unreachable.length,
      },
      description: describeSelector(selector, await this.labelsFor(organizationId, selector)),
    };
  }

  /* ── Student-derived audiences ────────────────────────────────────────── */

  private async resolveStudentDerived(
    organizationId: string,
    selector: ReturnType<typeof parseAudienceSelector>,
    cc?: string,
  ): Promise<AudienceMember[]> {
    const where = await this.studentWhere(organizationId, selector);
    const found = await this.prisma.raw.studentProfile.findMany({
      where,
      select: {
        id: true,
        partner: { select: { name: true, phone: true, phoneE164: true, email: true } },
      },
    });
    if (found.length === 0) return [];

    // The class a message names is where the learner is placed (ADR-027). This
    // runs from subscribers and cron, outside any tenant context, so the lookup
    // is told the organization explicitly.
    const placed = await this.placements.attach(found, { organizationId });
    const classIds = [...new Set(placed.map((p) => p.placement?.classId).filter(Boolean) as string[])];
    const classNames = new Map<string, string>(
      classIds.length === 0
        ? []
        : (
            await this.prisma.raw.schoolClass.findMany({
              where: { organizationId, id: { in: classIds } },
              select: { id: true, name: true },
            })
          ).map((c) => [c.id, c.name]),
    );
    const students = placed.map((p) => ({
      ...p,
      className: p.placement ? (classNames.get(p.placement.classId) ?? null) : null,
    }));

    const out: AudienceMember[] = [];

    // Students addressed directly (own phone / portal login).
    if (selector.recipients === 'students' || selector.recipients === 'both') {
      const portalByStudent = await this.portalUsersByStudent(
        organizationId,
        students.map((s) => s.id),
      );
      for (const s of students) {
        out.push({
          kind: 'student',
          subjectType: 'student_profile',
          subjectId: s.id,
          displayName: s.partner?.name ?? 'Student',
          phone: this.phone(s.partner?.phoneE164 ?? s.partner?.phone, cc),
          email: s.partner?.email ?? null,
          userId: portalByStudent.get(s.id) ?? null,
          studentProfileId: s.id,
          studentName: s.partner?.name ?? null,
          className: s.className,
          relationship: null,
        });
      }
    }

    if (selector.recipients === 'students') return out;

    // Guardians. One row per guardianship, so a parent appears once per child —
    // dedupe() collapses that according to the selector's mode.
    const byStudent = new Map(students.map((s) => [s.id, s]));
    const guardianships: {
      studentProfileId: string;
      relationship: string;
      guardianContactId: string;
      guardianContact: { firstName: string; lastName: string | null; phone: string | null; email: string | null } | null;
    }[] = [];

    for (const ids of chunk(students.map((s) => s.id))) {
      const rows = await this.prisma.raw.studentGuardian.findMany({
        where: {
          organizationId,
          studentProfileId: { in: ids },
          deletedAt: null,
          ...(selector.primaryGuardianOnly ? { isPrimary: true } : {}),
          ...(selector.statementRecipientsOnly ? { receivesStatements: true } : {}),
        },
        select: {
          studentProfileId: true,
          relationship: true,
          guardianContactId: true,
          guardianContact: { select: { firstName: true, lastName: true, phone: true, email: true } },
        },
      });
      guardianships.push(...rows);
    }

    // A family with no guardian flagged primary would otherwise silently receive
    // nothing. Fall back to every guardian on file for exactly those students.
    if (selector.primaryGuardianOnly) {
      const covered = new Set(guardianships.map((g) => g.studentProfileId));
      const missing = students.map((s) => s.id).filter((id) => !covered.has(id));
      for (const ids of chunk(missing)) {
        const rows = await this.prisma.raw.studentGuardian.findMany({
          where: {
            organizationId,
            studentProfileId: { in: ids },
            deletedAt: null,
            ...(selector.statementRecipientsOnly ? { receivesStatements: true } : {}),
          },
          select: {
            studentProfileId: true,
            relationship: true,
            guardianContactId: true,
            guardianContact: { select: { firstName: true, lastName: true, phone: true, email: true } },
          },
        });
        guardianships.push(...rows);
      }
    }

    const portalByContact = await this.portalUsersByGuardianContact(
      organizationId,
      guardianships.map((g) => g.guardianContactId),
    );

    for (const g of guardianships) {
      const student = byStudent.get(g.studentProfileId);
      const c = g.guardianContact;
      out.push({
        kind: 'guardian',
        subjectType: 'contact',
        subjectId: g.guardianContactId,
        displayName: [c?.firstName, c?.lastName].filter(Boolean).join(' ') || 'Guardian',
        phone: this.phone(c?.phone, cc),
        email: c?.email ?? null,
        userId: portalByContact.get(g.guardianContactId) ?? null,
        studentProfileId: g.studentProfileId,
        studentName: student?.partner?.name ?? null,
        className: student?.className ?? null,
        relationship: g.relationship,
      });
    }
    return out;
  }

  /**
   * Build the student `where`. Grade and campus are one hop away (they live on
   * SchoolClass), so they are resolved to class ids first rather than through a
   * nested relation filter — the same shape the class scope already uses, and it
   * keeps the eventual query planable on a large roster.
   */
  private async studentWhere(
    organizationId: string,
    selector: ReturnType<typeof parseAudienceSelector>,
  ): Promise<Record<string, unknown>> {
    const base: Record<string, unknown> = {
      organizationId,
      deletedAt: null,
      status: { in: selector.studentStatus },
    };
    switch (selector.scope) {
      case 'all':
        return base;
      case 'students':
        return { ...base, id: { in: selector.ids } };
      case 'class':
        return { ...base, ...this.placements.studentWhere({ classIds: selector.ids }) };
      case 'section':
        return { ...base, ...this.placements.studentWhere({ sectionIds: selector.ids }) };
      case 'stream':
        // A stream IS a section (ADR-029); saved 'stream' audiences hold section ids.
        return { ...base, ...this.placements.studentWhere({ sectionIds: selector.ids }) };
      case 'house':
        return { ...base, house: { in: selector.ids } };
      case 'residence':
        return { ...base, residenceType: { in: selector.ids } };
      case 'grade':
      case 'campus': {
        const classes = await this.prisma.raw.schoolClass.findMany({
          where: {
            organizationId,
            deletedAt: null,
            ...(selector.scope === 'grade'
              ? { gradeLevelId: { in: selector.ids } }
              : { campusId: { in: selector.ids } }),
          },
          select: { id: true },
        });
        return {
          ...base,
          ...this.placements.studentWhere({ classIds: classes.map((c) => c.id) }),
        };
      }
      default:
        return base;
    }
  }

  /* ── Staff audiences ──────────────────────────────────────────────────── */

  private async resolveStaff(
    organizationId: string,
    selector: ReturnType<typeof parseAudienceSelector>,
    cc?: string,
  ): Promise<AudienceMember[]> {
    const staff = await this.prisma.raw.staffProfile.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: 'active',
        ...(selector.scope === 'department' ? { departmentId: { in: selector.ids } } : {}),
        ...(selector.staffCategory?.length ? { staffCategory: { in: selector.staffCategory } } : {}),
      },
      select: {
        id: true,
        partner: { select: { name: true, phone: true, phoneE164: true, email: true } },
      },
    });
    if (staff.length === 0) return [];

    // Staff have no FK to User (StaffProfile hangs off Partner, the login does
    // not). Email is the only available join, so it is used ONLY when it matches
    // exactly one active account — an ambiguous match resolves to no user rather
    // than to the wrong colleague's inbox.
    const emails = staff.map((s) => s.partner?.email).filter((e): e is string => !!e);
    const userByEmail = new Map<string, string>();
    for (const batch of chunk(emails)) {
      const users = await this.prisma.raw.user.findMany({
        where: { organizationId, deletedAt: null, isActive: true, email: { in: batch } },
        select: { id: true, email: true },
      });
      const seen = new Map<string, string | null>();
      for (const u of users) {
        seen.set(u.email, seen.has(u.email) ? null : u.id);
      }
      for (const [email, id] of seen) if (id) userByEmail.set(email, id);
    }

    return staff.map((s) => ({
      kind: 'staff' as const,
      subjectType: 'staff_profile',
      subjectId: s.id,
      displayName: s.partner?.name ?? 'Staff',
      phone: this.phone(s.partner?.phoneE164 ?? s.partner?.phone, cc),
      email: s.partner?.email ?? null,
      userId: (s.partner?.email && userByEmail.get(s.partner.email)) || null,
      studentProfileId: null,
      studentName: null,
      className: null,
      relationship: null,
    }));
  }

  /* ── Helpers ──────────────────────────────────────────────────────────── */

  private async portalUsersByStudent(organizationId: string, studentIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const ids of chunk(studentIds)) {
      const rows = await this.prisma.raw.portalIdentity.findMany({
        where: { organizationId, subjectType: 'student', studentProfileId: { in: ids }, revokedAt: null },
        select: { studentProfileId: true, userId: true },
      });
      for (const r of rows) if (r.studentProfileId) out.set(r.studentProfileId, r.userId);
    }
    return out;
  }

  private async portalUsersByGuardianContact(organizationId: string, contactIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const ids of chunk([...new Set(contactIds)])) {
      const rows = await this.prisma.raw.portalIdentity.findMany({
        where: { organizationId, subjectType: 'guardian', guardianContactId: { in: ids }, revokedAt: null },
        select: { guardianContactId: true, userId: true },
      });
      for (const r of rows) if (r.guardianContactId) out.set(r.guardianContactId, r.userId);
    }
    return out;
  }

  /**
   * Normalize a roster phone number, tolerating the junk real rosters contain
   * ('n/a', '-', a landline typed into a mobile field). An unparseable number
   * becomes null — the person then shows up in `unreachable` for the registrar,
   * rather than becoming a delivery that fails six times at the gateway.
   */
  private phone(raw: string | null | undefined, cc?: string): string | null {
    if (!raw) return null;
    try {
      return normalizeE164(raw, cc);
    } catch {
      return null;
    }
  }

  /**
   * Collapse duplicate rows.
   *
   * per_recipient keys on the ADDRESS (phone, else user id), not on the person
   * record: two Contact rows for the same mother, or a mother and father sharing
   * one family phone, are one handset and must receive one message. The surviving
   * row keeps the first child's context so `{{student.name}}` still renders.
   */
  private dedupe(members: AudienceMember[], mode: 'per_recipient' | 'per_student'): AudienceMember[] {
    const seen = new Set<string>();
    const out: AudienceMember[] = [];
    for (const m of members) {
      const address = m.phone ?? (m.userId ? `user:${m.userId}` : `${m.subjectType}:${m.subjectId}`);
      const key = mode === 'per_student' ? `${address}|${m.studentProfileId ?? ''}` : address;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
    return out;
  }

  /** Human labels for the ids in a selector, for the audit description. */
  private async labelsFor(
    organizationId: string,
    selector: ReturnType<typeof parseAudienceSelector>,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (selector.ids.length === 0) return out;
    const load = async (rows: { id: string; name: string }[]) => {
      for (const r of rows) out.set(r.id, r.name);
    };
    switch (selector.scope) {
      case 'class':
        await load(
          await this.prisma.raw.schoolClass.findMany({
            where: { organizationId, id: { in: selector.ids } },
            select: { id: true, name: true },
          }),
        );
        break;
      case 'grade':
        await load(
          await this.prisma.raw.gradeLevel.findMany({
            where: { organizationId, id: { in: selector.ids } },
            select: { id: true, name: true },
          }),
        );
        break;
      case 'section':
      case 'stream':
        await load(
          await this.prisma.raw.section.findMany({
            where: { organizationId, id: { in: selector.ids } },
            select: { id: true, name: true },
          }),
        );
        break;
      case 'department':
        await load(
          await this.prisma.raw.department.findMany({
            where: { organizationId, id: { in: selector.ids } },
            select: { id: true, name: true },
          }),
        );
        break;
      default:
        break;
    }
    return out;
  }
}
