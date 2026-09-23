import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { assertYearWritable } from '../foundation/academic-year-guard';
import type {
  BulkGenerateOfferingsDto,
  CreateCourseOfferingDto,
  CreateActivityDefinitionDto,
  MigrateTeacherAssignmentsDto,
  RolloverOfferingDto,
  SetCourseEnrollmentDto,
  SyncCourseRosterDto,
  TeacherAllocationDto,
  TransitionCourseOfferingDto,
  UpdateCourseOfferingDto,
} from './course-offering.dto';
import { OFFERING_TYPES } from './course-offering.dto';

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['STAFFED', 'ARCHIVED'],
  STAFFED: ['DRAFT', 'ROSTER_READY', 'ARCHIVED'],
  ROSTER_READY: ['STAFFED', 'PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['ACTIVE', 'CLOSED'],
  ACTIVE: ['CLOSED'],
  CLOSED: ['ARCHIVED'],
  ARCHIVED: [],
};

@Injectable()
export class CourseOfferingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private get org() { return this.tenant.organizationId; }
  private get actor() { return this.tenant.userId ?? undefined; }

  async activityDefinitions() {
    return this.prisma.client.learningActivity.findMany({ where: { organizationId: this.org }, orderBy: { title: 'asc' } });
  }

  async createActivityDefinition(dto: CreateActivityDefinitionDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.learningActivity.create({ data: { organizationId: this.org, type: dto.type ?? 'co_curricular', title: dto.title.trim(), content: dto.description ? { description: dto.description } : {} } });
      await this.audit.recordInTx(tx, { entity: 'LearningActivity', entityId: row.id, action: 'create', newValues: row });
      return row;
    });
  }

  private include = {
    academicYear: true,
    term: true,
    programme: true,
    classCohort: { include: { schoolClass: { include: { gradeLevel: true } } } },
    subject: true,
    section: true,
    curriculum: { select: { id: true, name: true, version: true, status: true } },
    competency: true,
    activityDefinition: true,
    teachers: { include: { teacher: { include: { partner: true } } }, orderBy: { createdAt: 'asc' as const } },
    _count: { select: { courseEnrollments: true, timetableSlots: true } },
  };

  async list(filters: { academicYearId?: string; termId?: string; programmeId?: string; classCohortId?: string; status?: string; offeringType?: string; search?: string }) {
    if (filters.offeringType && !OFFERING_TYPES.includes(filters.offeringType as any)) throw new BadRequestException('Unknown offering type.');
    const rows = await this.prisma.client.courseOffering.findMany({
      where: {
        ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
        ...(filters.termId ? { termId: filters.termId } : {}),
        ...(filters.programmeId ? { programmeId: filters.programmeId } : {}),
        ...(filters.classCohortId ? { classCohortId: filters.classCohortId } : {}),
        ...(filters.status ? { status: filters.status as any } : {}),
        ...(filters.offeringType ? { offeringType: filters.offeringType as any } : {}),
        ...(filters.search ? { OR: [
          { name: { contains: filters.search, mode: 'insensitive' } },
          { code: { contains: filters.search, mode: 'insensitive' } },
        ] } : {}),
      },
      include: this.include,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row: any) => ({ ...row, readiness: this.readiness(row) }));
  }

  async get(id: string) {
    const row = await this.prisma.client.courseOffering.findFirst({ where: { id }, include: this.include });
    if (!row) throw new NotFoundException(`Course offering ${id} not found`);
    return { ...row, readiness: this.readiness(row as any) };
  }

  private readiness(row: any) {
    const curriculumRequired = ['SUBJECT', 'LEARNING_AREA', 'REMEDIAL'].includes(row.offeringType);
    const timetableRequired = !['SCHOOL_WIDE', 'CO_CURRICULAR', 'CLUB_OR_HOUSE'].includes(row.offeringType);
    const checks = {
      programme: !!row.programmeId,
      audience: row.audienceScope === 'SCHOOL' || row.audienceScope === 'CUSTOM' || !!row.classCohortId,
      responsibleStaff: row.teachers?.some((t: any) => t.isResponsible && !t.effectiveTo) ?? false,
      curriculum: !curriculumRequired || row.curriculum?.status === 'published',
      roster: (row._count?.courseEnrollments ?? 0) > 0,
      timetable: !timetableRequired || (row._count?.timetableSlots ?? 0) > 0,
    };
    return { checks, readyToPublish: Object.values(checks).every(Boolean) };
  }

  private code(name: string) {
    const stem = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'OFFERING';
    return `${stem}-${randomUUID().slice(0, 6).toUpperCase()}`;
  }

  private async validateContext(dto: CreateCourseOfferingDto, tx: any = this.prisma.client) {
    // Teaching is planned in open years only; a closed year's offerings are history.
    await assertYearWritable(tx, this.org, dto.academicYearId, 'create');
    const [year, term, programme] = await Promise.all([
      tx.academicYear.findFirst({ where: { id: dto.academicYearId, organizationId: this.org } }),
      tx.term.findFirst({ where: { id: dto.termId, organizationId: this.org } }),
      tx.academicProgramme.findFirst({ where: { id: dto.programmeId, organizationId: this.org, isActive: true } }),
    ]);
    if (!year || !term || !programme) throw new BadRequestException('Academic year, term and active programme must belong to this school.');
    if (term.academicYearId !== year.id) throw new BadRequestException('The selected term does not belong to the academic year.');

    let cohort: any = null;
    if (dto.classCohortId) {
      cohort = await tx.classCohort.findFirst({ where: { id: dto.classCohortId, organizationId: this.org } });
      if (!cohort || cohort.academicYearId !== year.id || cohort.programmeId !== programme.id) {
        throw new BadRequestException('The cohort must belong to the selected academic year and programme.');
      }
    }
    if (!['SCHOOL', 'CUSTOM'].includes(dto.audienceScope) && !cohort) {
      throw new BadRequestException(`${dto.audienceScope} audience requires an annual class cohort.`);
    }
    if (dto.audienceScope === 'SECTION' && !dto.sectionId) throw new BadRequestException('SECTION audience requires sectionId.');
    // ADR-029: a stream IS a section now. A STREAM audience is refused rather than
    // quietly treated as a section so a stale client learns what changed.
    if (dto.audienceScope === 'STREAM' || dto.streamId) {
      throw new BadRequestException(
        'Streams are now kept as sections (ADR-029). Use a SECTION audience with the stream\'s sectionId.',
      );
    }
    if (dto.sectionId) {
      const section = await tx.section.findFirst({ where: { id: dto.sectionId, organizationId: this.org } });
      if (!section || !cohort || section.classId !== cohort.classId) throw new BadRequestException('Section does not belong to the selected cohort class.');
    }

    const curriculumTypes = ['SUBJECT', 'LEARNING_AREA', 'REMEDIAL'];
    if (curriculumTypes.includes(dto.offeringType)) {
      if (!dto.subjectId || !dto.curriculumId) throw new BadRequestException(`${dto.offeringType} requires subjectId and a published curriculum version.`);
      const subject = await tx.subject.findFirst({ where: { id: dto.subjectId, organizationId: this.org }, select: { isActive: true, name: true } });
      if (!subject) throw new BadRequestException('Subject does not belong to this school.');
      if (!subject.isActive) throw new BadRequestException(`"${subject.name}" has been retired and cannot be offered.`);
      const curriculum = await tx.curriculum.findFirst({
        where: { id: dto.curriculumId, organizationId: this.org, academicYearId: year.id, status: 'published', subjects: { some: { subjectId: dto.subjectId } } },
      });
      if (!curriculum || (cohort && curriculum.classId !== cohort.classId)) throw new BadRequestException('Published curriculum does not contain this subject for the selected cohort/year.');
    }
    if (dto.offeringType === 'COMPETENCY') {
      if (!dto.competencyId) throw new BadRequestException('COMPETENCY requires competencyId.');
      const exists = await tx.competency.findFirst({ where: { id: dto.competencyId, organizationId: this.org } });
      if (!exists) throw new BadRequestException('Competency definition not found.');
    }
    if (['CO_CURRICULAR', 'CLUB_OR_HOUSE'].includes(dto.offeringType)) {
      if (!dto.activityDefinitionId) throw new BadRequestException(`${dto.offeringType} requires an activity definition.`);
      const exists = await tx.learningActivity.findFirst({ where: { id: dto.activityDefinitionId, organizationId: this.org } });
      if (!exists) throw new BadRequestException('Activity definition not found.');
    }
    const from = new Date(dto.effectiveFrom);
    const to = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    if (to && to < from) throw new BadRequestException('effectiveTo must be on or after effectiveFrom.');
    return { year, term, programme, cohort };
  }

  async create(dto: CreateCourseOfferingDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const { cohort } = await this.validateContext(dto, tx);
      const code = (dto.code?.trim() || this.code(dto.name)).toUpperCase();
      const duplicate = await tx.courseOffering.findFirst({ where: { organizationId: this.org, code } });
      if (duplicate) throw new ConflictException(`Offering code '${code}' already exists.`);
      const row = await tx.courseOffering.create({
        data: {
          organizationId: this.org, code, name: dto.name.trim(), academicYearId: dto.academicYearId,
          termId: dto.termId, programmeId: dto.programmeId, classCohortId: dto.classCohortId,
          classId: cohort?.classId, offeringType: dto.offeringType, audienceScope: dto.audienceScope,
          subjectId: dto.subjectId, sectionId: dto.sectionId,
          curriculumId: dto.curriculumId, competencyId: dto.competencyId,
          activityDefinitionId: dto.activityDefinitionId, effectiveFrom: new Date(dto.effectiveFrom),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null, summary: dto.summary,
        },
      });
      for (const teacher of dto.teachers ?? []) await this.allocateTeacherInTx(tx, row.id, teacher);
      await this.audit.recordInTx(tx, { entity: 'CourseOffering', entityId: row.id, action: 'create', newValues: row });
      return tx.courseOffering.findFirst({ where: { id: row.id }, include: this.include });
    });
  }

  async update(id: string, dto: UpdateCourseOfferingDto) {
    const current: any = await this.get(id);
    if (!['DRAFT', 'STAFFED'].includes(current.status)) throw new BadRequestException('Only DRAFT or STAFFED offerings may be edited.');
    const from = dto.effectiveFrom ? new Date(dto.effectiveFrom) : current.effectiveFrom;
    const to = dto.effectiveTo ? new Date(dto.effectiveTo) : current.effectiveTo;
    if (to && to < from) throw new BadRequestException('effectiveTo must be on or after effectiveFrom.');
    return this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.courseOffering.update({ where: { id }, data: {
        name: dto.name?.trim(), summary: dto.summary,
        effectiveFrom: dto.effectiveFrom ? from : undefined, effectiveTo: dto.effectiveTo ? to : undefined,
      } });
      await this.audit.recordInTx(tx, { entity: 'CourseOffering', entityId: id, action: 'update', oldValues: current, newValues: row });
      return row;
    });
  }

  private async allocateTeacherInTx(tx: any, offeringId: string, dto: TeacherAllocationDto) {
    const teacher = await tx.staffProfile.findFirst({ where: { id: dto.teacherPartnerId, organizationId: this.org, deletedAt: null } });
    if (!teacher) throw new BadRequestException('Teacher does not belong to this school.');
    // Only someone currently employed can be given teaching. A leaver keeps every
    // historical allocation; they just cannot receive new ones.
    const status: string = teacher.status ?? 'active';
    if (status !== 'active' && status !== 'on_leave') {
      throw new BadRequestException(`This staff member is ${status.replace('_', ' ')} and cannot be allocated teaching.`);
    }
    const role = dto.role ?? 'LEAD';
    const from = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();
    const to = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    if (to && to < from) throw new BadRequestException('Teacher allocation end date must be on or after its start date.');
    if (role === 'SUBSTITUTE') {
      if (!dto.replacedTeacherId || !to) throw new BadRequestException('A substitute allocation requires the replaced teacher and an end date.');
      if (dto.replacedTeacherId === dto.teacherPartnerId) throw new BadRequestException('A teacher cannot substitute for themselves.');
      const replaced = await tx.courseOfferingTeacher.findUnique({ where: { courseOfferingId_teacherPartnerId: { courseOfferingId: offeringId, teacherPartnerId: dto.replacedTeacherId } } });
      if (!replaced || replaced.effectiveTo) throw new BadRequestException('The replaced teacher must have an active allocation on this offering.');
    }
    return tx.courseOfferingTeacher.upsert({
      where: { courseOfferingId_teacherPartnerId: { courseOfferingId: offeringId, teacherPartnerId: dto.teacherPartnerId } },
      create: {
        organizationId: this.org, courseOfferingId: offeringId, teacherPartnerId: dto.teacherPartnerId,
        role, isResponsible: role === 'LEAD' || (dto.isResponsible ?? false),
        effectiveFrom: from, effectiveTo: to, replacedTeacherId: dto.replacedTeacherId,
      },
      update: {
        role, isResponsible: role === 'LEAD' || (dto.isResponsible ?? false),
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        effectiveTo: to, replacedTeacherId: dto.replacedTeacherId,
      },
    });
  }

  async allocateTeacher(id: string, dto: TeacherAllocationDto) {
    await this.get(id);
    return this.prisma.client.$transaction(async (tx: any) => {
      const row = await this.allocateTeacherInTx(tx, id, dto);
      await this.audit.recordInTx(tx, { entity: 'CourseOfferingTeacher', entityId: row.id, action: 'create', newValues: row });
      return row;
    });
  }

  async endTeacherAllocation(id: string, teacherId: string) {
    const offering: any = await this.get(id);
    const allocation = offering.teachers.find((t: any) => t.id === teacherId || t.teacherPartnerId === teacherId);
    if (!allocation) throw new NotFoundException('Teacher allocation not found.');
    if (allocation.isResponsible && ['STAFFED', 'ROSTER_READY', 'PUBLISHED', 'ACTIVE'].includes(offering.status)) {
      const other = offering.teachers.some((t: any) => t.id !== allocation.id && t.isResponsible && !t.effectiveTo);
      if (!other) throw new BadRequestException('Allocate another responsible teacher before ending this assignment.');
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.courseOfferingTeacher.update({ where: { id: allocation.id }, data: { effectiveTo: new Date(), isResponsible: false } });
      await this.audit.recordInTx(tx, { entity: 'CourseOfferingTeacher', entityId: row.id, action: 'update', oldValues: allocation, newValues: row });
      return row;
    });
  }

  private placementWhere(offering: any) {
    const scope: any = {
      enrollment: { academicYearId: offering.academicYearId, programmeId: offering.programmeId, status: 'ACTIVE' },
      termId: offering.termId,
      effectiveFrom: { lte: offering.term.endDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: offering.term.startDate } }],
    };
    if (offering.audienceScope !== 'SCHOOL') scope.classCohortId = offering.classCohortId;
    if (offering.audienceScope === 'SECTION') scope.sectionId = offering.sectionId;
    return scope;
  }

  async syncRoster(id: string, dto: SyncCourseRosterDto = {}) {
    const offering: any = await this.get(id);
    if (offering.audienceScope === 'CUSTOM') return { created: 0, retained: offering._count.courseEnrollments, skipped: 'CUSTOM rosters are explicitly managed.' };
    const curriculumSubject = offering.curriculumId && offering.subjectId
      ? await this.prisma.client.curriculumSubject.findFirst({ where: { curriculumId: offering.curriculumId, subjectId: offering.subjectId } }) : null;
    const isCompulsory = offering.offeringType === 'REMEDIAL' ? false : (curriculumSubject?.isCore ?? offering.offeringType !== 'SUBJECT');
    if (!isCompulsory && !dto.includeElectives) return { created: 0, retained: offering._count.courseEnrollments, skipped: 'Elective offering; enroll learners explicitly.' };
    const placements = await this.prisma.client.enrollmentPlacement.findMany({ where: this.placementWhere(offering), select: { enrollmentId: true } });
    let created = 0;
    await this.prisma.client.$transaction(async (tx: any) => {
      for (const placement of placements) {
        const existing = await tx.courseEnrollment.findUnique({ where: { courseOfferingId_studentEnrollmentId: { courseOfferingId: id, studentEnrollmentId: placement.enrollmentId } } });
        if (existing?.source === 'OPT_OUT' || existing?.status === 'OPTED_OUT') continue;
        await tx.courseEnrollment.upsert({
          where: { courseOfferingId_studentEnrollmentId: { courseOfferingId: id, studentEnrollmentId: placement.enrollmentId } },
          create: { organizationId: this.org, courseOfferingId: id, studentEnrollmentId: placement.enrollmentId, source: 'COMPULSORY', status: 'ENROLLED', startDate: offering.effectiveFrom, createdBy: this.actor },
          update: {},
        });
        if (!existing) created++;
      }
      await this.audit.recordInTx(tx, { entity: 'CourseOffering', entityId: id, action: 'update', newValues: { rosterSync: { created, eligible: placements.length } } });
    });
    return { created, eligible: placements.length, retained: placements.length - created };
  }

  async setEnrollment(id: string, dto: SetCourseEnrollmentDto) {
    const offering: any = await this.get(id);
    const enrollment = await this.prisma.client.studentEnrollment.findFirst({ where: { id: dto.studentEnrollmentId, organizationId: this.org, academicYearId: offering.academicYearId } });
    if (!enrollment) throw new BadRequestException('Student enrollment must belong to this school and academic year.');
    if (enrollment.programmeId !== offering.programmeId) throw new BadRequestException('Student enrollment is not in the offering programme.');
    const status = dto.status ?? (dto.source === 'OPT_OUT' ? 'OPTED_OUT' : 'ENROLLED');
    if (status === 'WITHDRAWN' && !dto.withdrawalReason) throw new BadRequestException('A withdrawn course enrollment requires a reason.');
    const startDate = dto.startDate ? new Date(dto.startDate) : offering.effectiveFrom;
    const endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (endDate && endDate < startDate) throw new BadRequestException('Course enrollment end date must be on or after its start date.');
    if (!['CUSTOM', 'SCHOOL'].includes(offering.audienceScope)) {
      const eligible = await this.prisma.client.enrollmentPlacement.findFirst({ where: {
        enrollmentId: enrollment.id, termId: offering.termId, classCohortId: offering.classCohortId,
        ...(offering.audienceScope === 'SECTION' ? { sectionId: offering.sectionId } : {}),
      } });
      if (!eligible) throw new BadRequestException('Learner placement is outside this offering audience.');
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.courseEnrollment.upsert({
        where: { courseOfferingId_studentEnrollmentId: { courseOfferingId: id, studentEnrollmentId: dto.studentEnrollmentId } },
        create: { organizationId: this.org, courseOfferingId: id, studentEnrollmentId: dto.studentEnrollmentId, source: dto.source, status, startDate, endDate, withdrawalReason: dto.withdrawalReason, createdBy: this.actor },
        update: { source: dto.source, status, startDate: dto.startDate ? startDate : undefined, endDate, withdrawalReason: dto.withdrawalReason, updatedBy: this.actor },
      });
      await this.audit.recordInTx(tx, { entity: 'CourseEnrollment', entityId: row.id, action: 'update', newValues: row });
      return row;
    });
  }

  async roster(id: string) {
    await this.get(id);
    return this.prisma.client.courseEnrollment.findMany({
      where: { courseOfferingId: id },
      include: { studentEnrollment: { include: { student: { include: { partner: true } }, placements: { where: { effectiveTo: null }, include: { section: true } } } } },
      orderBy: { studentEnrollment: { student: { partner: { name: 'asc' } } } },
    });
  }

  async transition(id: string, dto: TransitionCourseOfferingDto) {
    const current: any = await this.get(id);
    if (!TRANSITIONS[current.status]?.includes(dto.toStatus)) throw new BadRequestException(`Invalid offering transition ${current.status} → ${dto.toStatus}.`);
    const readiness = current.readiness;
    if (dto.toStatus === 'STAFFED' && !readiness.checks.responsibleStaff) throw new BadRequestException('A responsible teacher is required.');
    if (dto.toStatus === 'ROSTER_READY' && !readiness.checks.roster) throw new BadRequestException('Generate or add the course roster first.');
    if (dto.toStatus === 'PUBLISHED' && !readiness.readyToPublish) {
      const missing = Object.entries(readiness.checks).filter(([, ok]) => !ok).map(([key]) => key);
      throw new BadRequestException(`Offering is not publish-ready: ${missing.join(', ')}.`);
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.courseOffering.update({ where: { id }, data: { status: dto.toStatus, effectiveTo: dto.toStatus === 'CLOSED' ? new Date() : undefined } });
      await this.audit.recordInTx(tx, { entity: 'CourseOffering', entityId: id, action: 'update', oldValues: { status: current.status }, newValues: { status: dto.toStatus } });
      return row;
    });
  }

  async bulkGenerate(dto: BulkGenerateOfferingsDto) {
    const cohorts = await this.prisma.client.classCohort.findMany({ where: { id: { in: dto.classCohortIds }, academicYearId: dto.academicYearId }, include: { schoolClass: true, programme: true } });
    if (cohorts.length !== new Set(dto.classCohortIds).size) throw new BadRequestException('One or more cohorts are invalid for this academic year.');
    const created: any[] = [];
    const existing: any[] = [];
    for (const cohort of cohorts) {
      if (!cohort.programmeId) throw new BadRequestException(`Cohort ${cohort.schoolClass.name} has no programme.`);
      const curriculum = await this.prisma.client.curriculum.findFirst({ where: { academicYearId: dto.academicYearId, classId: cohort.classId, status: 'published' }, include: { subjects: { include: { subject: true } } }, orderBy: { version: 'desc' } });
      if (!curriculum) throw new BadRequestException(`No published curriculum for ${cohort.schoolClass.name}.`);
      for (const item of curriculum.subjects.filter((x: any) => dto.includeElectives || x.isCore)) {
        const found = await this.prisma.client.courseOffering.findFirst({ where: { termId: dto.termId, classCohortId: cohort.id, subjectId: item.subjectId, offeringType: 'SUBJECT' } });
        if (found) { existing.push(found); continue; }
        created.push(await this.create({
          name: `${cohort.schoolClass.name} ${item.subject.name}`, academicYearId: dto.academicYearId, termId: dto.termId,
          programmeId: cohort.programmeId, classCohortId: cohort.id, offeringType: 'SUBJECT', audienceScope: 'COHORT',
          subjectId: item.subjectId, curriculumId: curriculum.id, effectiveFrom: (await this.prisma.client.term.findFirst({ where: { id: dto.termId } }))!.startDate.toISOString(),
        }));
      }
    }
    return { created: created.length, existing: existing.length, offerings: [...created, ...existing] };
  }

  async migrateTeacherAssignments(dto: MigrateTeacherAssignmentsDto) {
    const assignments = await this.prisma.client.teacherAssignment.findMany({ where: dto.termId ? { termId: dto.termId } : {}, include: { subject: true, schoolClass: true, term: true } });
    const report = { source: assignments.length, mapped: 0, existing: 0, exceptions: [] as Array<{ id: string; reason: string }> };
    for (const assignment of assignments) {
      try {
        if (!assignment.termId || !assignment.term) throw new Error('Teacher assignment has no term.');
        const cohort = await this.prisma.client.classCohort.findFirst({ where: { academicYearId: assignment.term.academicYearId, classId: assignment.classId }, include: { programme: true } });
        if (!cohort?.programmeId) throw new Error('No annual cohort/programme mapping.');
        const curriculum = await this.prisma.client.curriculum.findFirst({ where: { academicYearId: assignment.term.academicYearId, classId: assignment.classId, status: 'published', subjects: { some: { subjectId: assignment.subjectId } } }, orderBy: { version: 'desc' } });
        if (!curriculum) throw new Error('No published curriculum containing the subject.');
        let offering = await this.prisma.client.courseOffering.findFirst({ where: { termId: assignment.termId, classCohortId: cohort.id, subjectId: assignment.subjectId, sectionId: assignment.sectionId } });
        if (offering) report.existing++;
        else if (!dto.dryRun) offering = await this.create({ name: `${assignment.schoolClass.name} ${assignment.subject.name}`, academicYearId: assignment.term.academicYearId, termId: assignment.termId, programmeId: cohort.programmeId, classCohortId: cohort.id, offeringType: 'SUBJECT', audienceScope: assignment.sectionId ? 'SECTION' : 'COHORT', subjectId: assignment.subjectId, sectionId: assignment.sectionId ?? undefined, curriculumId: curriculum.id, effectiveFrom: assignment.term.startDate.toISOString() }) as any;
        if (!dto.dryRun && offering) await this.allocateTeacher(offering.id, { teacherPartnerId: assignment.teacherPartnerId, role: 'LEAD', isResponsible: true, effectiveFrom: assignment.term.startDate.toISOString() });
        report.mapped++;
      } catch (error) { report.exceptions.push({ id: assignment.id, reason: error instanceof Error ? error.message : String(error) }); }
    }
    return report;
  }

  async rollover(id: string, dto: RolloverOfferingDto) {
    const source: any = await this.get(id);
    const cohort = dto.classCohortId ? await this.prisma.client.classCohort.findFirst({ where: { id: dto.classCohortId } }) : null;
    const term = await this.prisma.client.term.findFirst({ where: { id: dto.termId, academicYearId: dto.academicYearId } });
    if (!term) throw new BadRequestException('Target term does not belong to target academic year.');
    const copy = await this.create({
      name: source.name, academicYearId: dto.academicYearId, termId: dto.termId, programmeId: cohort?.programmeId ?? source.programmeId,
      classCohortId: dto.classCohortId ?? source.classCohortId, offeringType: source.offeringType, audienceScope: source.audienceScope,
      subjectId: source.subjectId, sectionId: source.sectionId, curriculumId: dto.curriculumId ?? source.curriculumId,
      competencyId: source.competencyId, activityDefinitionId: source.activityDefinitionId,
      effectiveFrom: dto.effectiveFrom ?? term.startDate.toISOString(), effectiveTo: dto.effectiveTo ?? term.endDate.toISOString(), summary: source.summary,
      teachers: dto.copyTeachers === false ? [] : source.teachers.filter((t: any) => !t.effectiveTo).map((t: any) => ({ teacherPartnerId: t.teacherPartnerId, role: t.role, isResponsible: t.isResponsible, effectiveFrom: dto.effectiveFrom ?? term.startDate.toISOString() })),
    }) as any;
    if (dto.syncRoster) await this.syncRoster(copy.id);
    return this.get(copy.id);
  }
}
