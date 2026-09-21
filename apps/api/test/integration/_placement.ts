/**
 * Shared academic-placement fixture (Phase 0 of the academic structure redesign).
 *
 * 29 integration specs currently seed a learner by writing
 * `StudentProfile.currentClassId` directly. Those columns are PROJECTIONS of the
 * newest open `EnrollmentPlacement` (schema.prisma:12112) and are being dropped,
 * so every one of those fixtures would otherwise need editing at the drop.
 *
 * Routing them through this helper makes that a ONE-FILE change: when the
 * projection columns go, only `linkLearner` below stops writing them. Specs keep
 * calling the same function.
 *
 * These builders use the RAW PrismaClient deliberately — fixtures run outside a
 * tenant context, so `organizationId` is passed explicitly on every write rather
 * than injected by the tenancy extension.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SpineOptions {
  organizationId: string;
  /** Defaults to the current calendar year. */
  yearName?: string;
  termName?: string;
  gradeName?: string;
  gradeOrder?: number;
  className?: string;
  /** Omit for a class with no subdivision; pass a name to create one section. */
  sectionName?: string | null;
  campusId?: string | null;
}

export interface AcademicSpine {
  organizationId: string;
  academicYearId: string;
  termId: string;
  gradeLevelId: string;
  classId: string;
  sectionId: string | null;
  programmeId: string;
  classCohortId: string;
}

/**
 * Create (or reuse) the full structural chain a placement needs:
 * AcademicYear then Term, GradeLevel, SchoolClass and Section, plus the
 * AcademicProgramme and ClassCohort that `EnrollmentPlacement` points at.
 *
 * Every step is find-or-create on a natural key, so a spec may call this more
 * than once — for a second class, or a second year — without unique-constraint
 * noise.
 */
export async function ensureAcademicSpine(raw: any, opts: SpineOptions): Promise<AcademicSpine> {
  const organizationId = opts.organizationId;
  const yearName = opts.yearName ?? String(new Date().getFullYear());
  const gradeName = opts.gradeName ?? 'P1';
  const className = opts.className ?? gradeName + ' East';

  const year =
    (await raw.academicYear.findFirst({ where: { organizationId, name: yearName } })) ??
    (await raw.academicYear.create({
      data: {
        organizationId,
        name: yearName,
        startDate: new Date(yearName + '-01-01'),
        endDate: new Date(yearName + '-12-31'),
        isCurrent: true,
      },
    }));

  const termName = opts.termName ?? 'Term 1';
  const term =
    (await raw.term.findFirst({
      where: { organizationId, academicYearId: year.id, name: termName },
    })) ??
    (await raw.term.create({
      data: {
        organizationId,
        academicYearId: year.id,
        name: termName,
        startDate: new Date(yearName + '-01-15'),
        endDate: new Date(yearName + '-04-15'),
        isCurrent: true,
      },
    }));

  const grade =
    (await raw.gradeLevel.findFirst({ where: { organizationId, name: gradeName } })) ??
    (await raw.gradeLevel.create({
      data: { organizationId, name: gradeName, order: opts.gradeOrder ?? 1 },
    }));

  const schoolClass =
    (await raw.schoolClass.findFirst({ where: { organizationId, name: className } })) ??
    (await raw.schoolClass.create({
      data: {
        organizationId,
        gradeLevelId: grade.id,
        name: className,
        ...(opts.campusId ? { campusId: opts.campusId } : {}),
      },
    }));

  let sectionId: string | null = null;
  if (opts.sectionName) {
    const section =
      (await raw.section.findFirst({
        where: { organizationId, classId: schoolClass.id, name: opts.sectionName },
      })) ??
      (await raw.section.create({
        data: { organizationId, classId: schoolClass.id, name: opts.sectionName },
      }));
    sectionId = section.id;
  }

  // The programme carries the grouping default. SECTION_ONLY when the caller
  // asked for a section, NONE otherwise — so `validateGrouping` agrees with the
  // structure the fixture actually built, rather than demanding a section that
  // was never created.
  const programmeCode = opts.sectionName ? 'FIXTURE_SECTIONED' : 'FIXTURE_PLAIN';
  const programme =
    (await raw.academicProgramme.findFirst({ where: { organizationId, code: programmeCode } })) ??
    (await raw.academicProgramme.create({
      data: {
        organizationId,
        code: programmeCode,
        name: 'Integration fixture programme',
        stage: 'OTHER',
        groupingMode: opts.sectionName ? 'SECTION_ONLY' : 'NONE',
        effectiveFrom: new Date(yearName + '-01-01'),
      },
    }));

  // A grade level belongs to exactly one programme per organization
  // (@@unique([organizationId, gradeLevelId])), so this is an upsert rather than
  // a create: a spec that builds two classes in the same grade must not collide.
  await raw.programmeGradeLevel.upsert({
    where: { organizationId_gradeLevelId: { organizationId, gradeLevelId: grade.id } },
    update: {},
    create: { organizationId, programmeId: programme.id, gradeLevelId: grade.id },
  });

  const cohort =
    (await raw.classCohort.findFirst({
      where: { organizationId, academicYearId: year.id, classId: schoolClass.id },
    })) ??
    (await raw.classCohort.create({
      data: {
        organizationId,
        academicYearId: year.id,
        classId: schoolClass.id,
        programmeId: programme.id,
        status: 'ACTIVE',
      },
    }));

  return {
    organizationId,
    academicYearId: year.id,
    termId: term.id,
    gradeLevelId: grade.id,
    classId: schoolClass.id,
    sectionId,
    programmeId: programme.id,
    classCohortId: cohort.id,
  };
}

export interface LinkOptions {
  spine: AcademicSpine;
  studentProfileId: string;
  /** Overrides the spine's section, e.g. to split learners across sections. */
  sectionId?: string | null;
  effectiveFrom?: Date;
  rollNumber?: string;
  admissionDate?: Date;
}

export interface LearnerPlacement {
  enrollmentId: string;
  placementId: string;
  classId: string;
  sectionId: string | null;
}

/**
 * Give an existing StudentProfile a canonical academic placement:
 * `StudentEnrollment` (membership for the year) plus an open
 * `EnrollmentPlacement` (which class/section, effective-dated).
 *
 * It also writes the `StudentProfile.current*` projection, exactly as
 * `PlacementService.syncProjection` does in production — which is what keeps the
 * 29 existing fixtures behaving identically today. When the projection columns
 * are dropped, delete only the marked `updateMany` below.
 */
export async function linkLearner(raw: any, opts: LinkOptions): Promise<LearnerPlacement> {
  const { spine, studentProfileId } = opts;
  const organizationId = spine.organizationId;
  const sectionId = opts.sectionId !== undefined ? opts.sectionId : spine.sectionId;
  const effectiveFrom = opts.effectiveFrom ?? new Date();

  const enrollment =
    (await raw.studentEnrollment.findFirst({
      where: { organizationId, studentProfileId, academicYearId: spine.academicYearId },
    })) ??
    (await raw.studentEnrollment.create({
      data: {
        organizationId,
        studentProfileId,
        academicYearId: spine.academicYearId,
        programmeId: spine.programmeId,
        gradeLevelId: spine.gradeLevelId,
        admissionDate: opts.admissionDate ?? effectiveFrom,
        status: 'ACTIVE',
        enrollmentType: 'NEW',
      },
    }));

  // Exactly one placement may be open per enrollment (a partial unique index
  // backs it), so close any open row before inserting the new one — the same
  // append-only discipline `PlacementService.appendPlacement` follows.
  await raw.enrollmentPlacement.updateMany({
    where: { organizationId, enrollmentId: enrollment.id, effectiveTo: null },
    data: { effectiveTo: effectiveFrom, endReason: 'CORRECTION' },
  });

  const placement = await raw.enrollmentPlacement.create({
    data: {
      organizationId,
      enrollmentId: enrollment.id,
      termId: spine.termId,
      classCohortId: spine.classCohortId,
      sectionId,
      rollNumber: opts.rollNumber ?? null,
      effectiveFrom,
      movementReason: 'INITIAL_PLACEMENT',
    },
  });

  // ---- Projection sync. Delete this block when the columns are dropped. ----
  await raw.studentProfile.updateMany({
    where: { id: studentProfileId },
    data: { currentClassId: spine.classId, currentSectionId: sectionId },
  });

  return {
    enrollmentId: enrollment.id,
    placementId: placement.id,
    classId: spine.classId,
    sectionId,
  };
}
