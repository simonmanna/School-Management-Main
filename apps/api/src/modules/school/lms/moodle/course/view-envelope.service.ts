import { Injectable } from '@nestjs/common';
import type { CourseModule, CourseOffering } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { PortalIdentityService } from '../../../../../kernel/auth/portal-identity.service';
import { ActivityRegistry } from '../activity/activity-registry.service';
import { CapabilityService } from '../context/capability.service';
import type {
  CourseHeader,
  CourseModuleView,
  ModuleAvailability,
  ModuleCompletion,
  ModuleGrade,
} from './view-envelope.types';

/**
 * Assembles the display envelope (L1.1) shared by the course page and the
 * activity page.
 *
 * Everything here is presentation composed from existing truth — names, grades,
 * completion, capabilities. It owns no data of its own and writes nothing. Marks
 * in particular are READ from the assessment spine; this service must never be a
 * second place a grade can come from.
 */
@Injectable()
export class ViewEnvelopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly registry: ActivityRegistry,
    private readonly caps: CapabilityService,
    private readonly portalIdentity: PortalIdentityService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /**
   * Display identity for a course. `CourseOffering` is keyed by
   * (year, term, subject, class, section) and has no name column, so the header
   * is composed — "Mathematics — S2 Blue (Term 1)" rather than a bare uuid.
   */
  async courseHeader(offering: CourseOffering): Promise<CourseHeader> {
    const [subject, klass, term, year] = await Promise.all([
      offering.subjectId ? this.prisma.client.subject.findFirst({ where: { id: offering.subjectId }, select: { name: true } }) : Promise.resolve(null),
      offering.classId ? this.prisma.client.schoolClass.findFirst({ where: { id: offering.classId }, select: { name: true } }) : Promise.resolve(null),
      this.prisma.client.term.findFirst({ where: { id: offering.termId }, select: { name: true } }),
      this.prisma.client.academicYear.findFirst({ where: { id: offering.academicYearId }, select: { name: true } }),
    ]);
    const parts = [subject?.name, klass?.name].filter(Boolean).join(' — ');
    const name = [offering.name || parts || 'Course', term?.name ? `(${term.name})` : ''].filter(Boolean).join(' ');
    return {
      id: offering.id,
      name,
      subject: subject?.name ?? null,
      className: klass?.name ?? null,
      term: term?.name ?? null,
      academicYear: year?.name ?? null,
      format: offering.format,
      summary: offering.summary ?? null,
      visible: offering.visible,
      completionEnabled: offering.completionEnabled,
      showGradesToStudents: offering.showGradesToStudents,
      startDate: offering.startDate?.toISOString() ?? null,
      endDate: offering.endDate?.toISOString() ?? null,
    };
  }

  /** Capabilities the caller actually holds on a course, as a flat list. */
  async capabilitiesFor(courseOfferingId: string): Promise<string[]> {
    const p = this.portalIdentity.principal();
    const principal = p.kind === 'student' ? { studentProfileId: p.studentProfileId } : { userId: p.userId };
    const effective = await this.caps.effectiveAtCourse(principal, courseOfferingId);
    return Object.entries(effective)
      .filter(([, allowed]) => allowed)
      .map(([capability]) => capability);
  }

  /**
   * Turn spine rows into renderable cards: names from each plugin (batched by
   * type), plus completion, grade and availability for the student in view.
   */
  async moduleViews(
    modules: CourseModule[],
    opts: {
      studentProfileId?: string;
      availabilityByModule?: Map<string, ModuleAvailability>;
      showGrades: boolean;
    },
  ): Promise<CourseModuleView[]> {
    if (modules.length === 0) return [];

    // One plugin call per activity TYPE, not per module.
    const byType = new Map<string, CourseModule[]>();
    for (const m of modules) {
      const list = byType.get(m.activityType) ?? [];
      list.push(m);
      byType.set(m.activityType, list);
    }
    const summaries = new Map<string, { name: string; intro?: string | null }>();
    const features = new Map<string, { gradable: boolean; icon: string; label: string }>();
    for (const [type, rows] of byType) {
      if (!this.registry.has(type)) continue;
      const plugin = this.registry.get(type);
      features.set(type, {
        gradable: plugin.features.gradable,
        icon: plugin.features.icon,
        label: plugin.features.label,
      });
      if (!plugin.instanceSummaries) continue;
      const found = await plugin.instanceSummaries(rows.map((r) => r.instanceId).filter(Boolean));
      for (const [id, sum] of found) summaries.set(id, sum);
    }

    const [completions, grades] = await Promise.all([
      this.completionMap(modules, opts.studentProfileId),
      opts.showGrades ? this.gradeMap(modules, opts.studentProfileId) : Promise.resolve(new Map<string, ModuleGrade>()),
    ]);

    return modules.map((m) => {
      const f = features.get(m.activityType);
      const summary = summaries.get(m.instanceId);
      return {
        id: m.id,
        activityType: m.activityType,
        // A missing summary means the instance row is gone — the orphan check
        // reports it; here it degrades to something a human can still read.
        name: summary?.name ?? f?.label ?? m.activityType,
        intro: summary?.intro ?? null,
        icon: f?.icon ?? 'File',
        visible: m.visible,
        sectionId: m.sectionId,
        sequence: m.sequence,
        openAt: m.openAt?.toISOString() ?? null,
        dueAt: m.dueAt?.toISOString() ?? null,
        cutoffAt: m.cutoffAt?.toISOString() ?? null,
        gradable: Boolean(m.assessmentId) && (f?.gradable ?? false),
        availability: opts.availabilityByModule?.get(m.id) ?? null,
        completion: completions.get(m.id) ?? null,
        grade: grades.get(m.id) ?? null,
      };
    });
  }

  /** completed / tracked for one student in one course. */
  async progressFor(courseOfferingId: string, studentProfileId: string) {
    const tracked = await this.prisma.client.courseModule.findMany({
      where: { organizationId: this.org, courseOfferingId, deletedAt: null, completionMode: { not: 'none' } },
      select: { id: true },
    });
    if (tracked.length === 0) return { completed: 0, tracked: 0, percent: 0 };
    const completed = await this.prisma.client.courseModuleCompletion.count({
      where: {
        organizationId: this.org,
        studentProfileId,
        courseModuleId: { in: tracked.map((t) => t.id) },
        state: { not: 'incomplete' },
      },
    });
    return {
      completed,
      tracked: tracked.length,
      percent: Math.round((completed / tracked.length) * 1000) / 10,
    };
  }

  /**
   * Display names for a batch of students (L1.3).
   *
   * The gradebook and participants list used to render `studentProfileId.slice(0, 8)`
   * — a uuid fragment — because the payload carried no names. The name lives on
   * the linked Partner row, one hop away.
   */
  async studentNames(studentProfileIds: string[]): Promise<Map<string, { name: string; admissionNo: string }>> {
    if (studentProfileIds.length === 0) return new Map();
    const rows = await this.prisma.client.studentProfile.findMany({
      where: { id: { in: studentProfileIds }, organizationId: this.org },
      select: { id: true, admissionNo: true, partner: { select: { name: true } } },
    });
    return new Map(
      rows.map((r) => [r.id, { name: r.partner?.name ?? r.admissionNo ?? 'Unknown student', admissionNo: r.admissionNo }]),
    );
  }

  /**
   * Display names for staff principals (teachers on a course, graders).
   *
   * Ids here are platform `User.id`s. Historic `LmsRoleAssignment` rows carry
   * a `StaffProfile.id` instead (roster sync used to write the wrong id), so
   * anything the User table cannot explain is resolved through the staff
   * profile as a fallback rather than rendering blank.
   */
  async userNames(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const out = new Map<string, string>();

    const users = await this.prisma.client.user.findMany({
      where: { id: { in: userIds }, organizationId: this.org },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    for (const r of users) {
      out.set(r.id, [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email);
    }

    const unresolved = userIds.filter((id) => !out.has(id));
    if (unresolved.length > 0) {
      const profiles = await this.prisma.client.staffProfile.findMany({
        where: { id: { in: unresolved }, organizationId: this.org },
        select: { id: true, employeeNo: true, partner: { select: { name: true } } },
      });
      for (const p of profiles) {
        out.set(p.id, p.partner?.name ?? p.employeeNo);
      }
    }
    return out;
  }

  // ── internals ──

  private async completionMap(modules: CourseModule[], studentProfileId?: string) {
    const out = new Map<string, ModuleCompletion>();
    if (!studentProfileId) return out;
    const rows = await this.prisma.client.courseModuleCompletion.findMany({
      where: {
        organizationId: this.org,
        studentProfileId,
        courseModuleId: { in: modules.map((m) => m.id) },
      },
    });
    const byModule = new Map(rows.map((r) => [r.courseModuleId, r]));
    for (const m of modules) {
      if (m.completionMode === 'none') continue;
      const row = byModule.get(m.id);
      out.set(m.id, {
        mode: m.completionMode as ModuleCompletion['mode'],
        state: (row?.state as ModuleCompletion['state']) ?? 'incomplete',
        rules: (m.completionRules ?? {}) as Record<string, unknown>,
        overridden: Boolean(row?.overriddenById),
      });
    }
    return out;
  }

  /**
   * Grades read straight from the assessment spine — never recomputed here.
   *
   * Two gates, both deliberate:
   *  - `Assessment.hiddenFromStudents` hides the column entirely.
   *  - `StudentAssessment.approvalStatus` must be `approved` before a score
   *    reaches a learner. Marks move draft → submitted → approved through the
   *    moderation workflow, and showing a draft would leak an un-moderated mark
   *    that a head of department may still change.
   *
   * An unreleased mark yields `score: null`, not zero, so the UI can say
   * "not released yet" rather than implying the student scored nothing.
   */
  private async gradeMap(modules: CourseModule[], studentProfileId?: string) {
    const out = new Map<string, ModuleGrade>();
    const gradable = modules.filter((m) => m.assessmentId);
    if (gradable.length === 0) return out;
    const assessmentIds = gradable.map((m) => m.assessmentId!);
    const assessments = await this.prisma.client.assessment.findMany({
      where: { id: { in: assessmentIds }, deletedAt: null },
      select: { id: true, maxScore: true, hiddenFromStudents: true },
    });
    const byAssessment = new Map(assessments.map((a) => [a.id, a]));

    const marks = studentProfileId
      ? await this.prisma.client.studentAssessment.findMany({
          where: { organizationId: this.org, assessmentId: { in: assessmentIds }, studentProfileId },
          select: { assessmentId: true, effectiveScore: true, percentage: true, approvalStatus: true, status: true },
        })
      : [];
    const byMark = new Map(marks.map((m) => [m.assessmentId, m]));

    for (const m of gradable) {
      const a = byAssessment.get(m.assessmentId!);
      if (!a || a.hiddenFromStudents) continue;
      const mark = byMark.get(m.assessmentId!);
      const released = mark?.approvalStatus === 'approved';
      out.set(m.id, {
        assessmentId: m.assessmentId!,
        maxScore: Number(a.maxScore ?? 100),
        score: released && mark?.effectiveScore != null ? Number(mark.effectiveScore) : null,
        percentage: released && mark?.percentage != null ? Number(mark.percentage) : null,
        submissionStatus: (mark?.status as string) ?? null,
        released,
      });
    }
    return out;
  }
}
