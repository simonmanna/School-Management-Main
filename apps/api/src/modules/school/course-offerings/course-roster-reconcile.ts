/**
 * Compulsory course rosters, reconciled from the placement that is the school's
 * actual record of who sits in a class.
 *
 * Admission wrote a StudentEnrollment and an EnrollmentPlacement and stopped
 * there. Course membership — the thing `AssessmentWorkflowService.captureRoster`
 * actually reads — was a separate manual `syncRoster` action on each offering, so
 * a learner admitted on Monday was simply missing from Friday's assessment and
 * the teacher had no way to know why. This closes that handoff: every placement
 * append reconciles the compulsory offerings for the class it lands in.
 *
 * Deliberately a plain function over a transaction client rather than an injected
 * service: PlacementService sits under enrollment and CourseOfferingService sits
 * over it, and making them depend on each other would need a forwardRef cycle for
 * no gain. It also means the reconciliation commits or rolls back with the
 * placement itself.
 *
 * Electives, remedial groups and CUSTOM audiences stay manual — a learner is
 * placed into those by a decision, not by arriving in the class.
 */

/** The offering shape this module needs; a superset is fine. */
export interface ReconcilableOffering {
  id: string;
  offeringType: string;
  audienceScope: string;
  curriculumId: string | null;
  subjectId: string | null;
  effectiveFrom: Date;
}

/**
 * Is membership of this offering automatic for everyone placed in the class?
 *
 * The curriculum is the authority when it has an opinion (`CurriculumSubject.isCore`).
 * Failing that, a bare SUBJECT is treated as an elective and everything else
 * (learning area, competency, school-wide, co-curricular) as compulsory. REMEDIAL
 * is never automatic: it exists precisely because someone chose those learners.
 */
export function isCompulsoryOffering(
  offering: { offeringType: string },
  curriculumSubject: { isCore: boolean } | null,
): boolean {
  if (offering.offeringType === 'REMEDIAL') return false;
  return curriculumSubject?.isCore ?? offering.offeringType !== 'SUBJECT';
}

export interface ReconcileTarget {
  organizationId: string;
  /** StudentEnrollment.id — CourseEnrollment hangs off the annual enrollment. */
  enrollmentId: string;
  termId: string;
  classCohortId: string | null;
  sectionId: string | null;
  effectiveFrom: Date;
  actorId?: string | null;
}

export interface ReconcileResult {
  enrolled: number;
  considered: number;
  /** Offering ids the learner was added to, for the audit trail. */
  offeringIds: string[];
}

/**
 * Enrol one learner into every compulsory offering that covers their new seat.
 *
 * Never reverses a deliberate decision: an existing OPT_OUT or OPTED_OUT row is
 * left alone, and an existing ENROLLED row is not rewritten (its start date is
 * part of the assessment record).
 */
export async function reconcileCompulsoryRostersInTx(
  tx: any,
  target: ReconcileTarget,
): Promise<ReconcileResult> {
  const offerings: ReconcilableOffering[] = await tx.courseOffering.findMany({
    where: {
      organizationId: target.organizationId,
      termId: target.termId,
      deletedAt: null,
      status: { not: 'ARCHIVED' },
      audienceScope: { not: 'CUSTOM' },
      OR: [
        { audienceScope: 'SCHOOL' },
        ...(target.classCohortId
          ? [
              {
                classCohortId: target.classCohortId,
                // A SECTION-scoped offering only covers learners in that stream.
                OR: [
                  { audienceScope: 'COHORT' },
                  { audienceScope: 'SECTION', sectionId: target.sectionId },
                ],
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      offeringType: true,
      audienceScope: true,
      curriculumId: true,
      subjectId: true,
      effectiveFrom: true,
    },
  });
  if (!offerings.length) return { enrolled: 0, considered: 0, offeringIds: [] };

  const offeringIds: string[] = [];
  for (const offering of offerings) {
    const curriculumSubject =
      offering.curriculumId && offering.subjectId
        ? await tx.curriculumSubject.findFirst({
            where: { curriculumId: offering.curriculumId, subjectId: offering.subjectId },
            select: { isCore: true },
          })
        : null;
    if (!isCompulsoryOffering(offering, curriculumSubject)) continue;

    const existing = await tx.courseEnrollment.findUnique({
      where: {
        courseOfferingId_studentEnrollmentId: {
          courseOfferingId: offering.id,
          studentEnrollmentId: target.enrollmentId,
        },
      },
      select: { id: true, source: true, status: true },
    });
    if (existing) continue;

    // The learner joins when they arrive, not when the offering opened — a late
    // admission must not appear on rosters frozen before they were here.
    const startDate =
      target.effectiveFrom > offering.effectiveFrom ? target.effectiveFrom : offering.effectiveFrom;
    await tx.courseEnrollment.create({
      data: {
        organizationId: target.organizationId,
        courseOfferingId: offering.id,
        studentEnrollmentId: target.enrollmentId,
        source: 'COMPULSORY',
        status: 'ENROLLED',
        startDate,
        createdBy: target.actorId ?? null,
      },
    });
    offeringIds.push(offering.id);
  }

  return { enrolled: offeringIds.length, considered: offerings.length, offeringIds };
}

/**
 * Learners placed in this offering's audience who are not on its course roster.
 *
 * Powers the "roster out of sync" warning: a teacher should see that three
 * learners are missing before they capture an assessment roster, not discover it
 * from a blank mark sheet.
 */
export async function countRosterDrift(
  client: any,
  offering: {
    id: string;
    termId: string;
    classCohortId: string | null;
    sectionId: string | null;
    audienceScope: string;
    offeringType: string;
    curriculumId: string | null;
    subjectId: string | null;
    term: { startDate: Date; endDate: Date };
  },
): Promise<number> {
  if (offering.audienceScope === 'CUSTOM') return 0;
  const curriculumSubject =
    offering.curriculumId && offering.subjectId
      ? await client.curriculumSubject.findFirst({
          where: { curriculumId: offering.curriculumId, subjectId: offering.subjectId },
          select: { isCore: true },
        })
      : null;
  if (!isCompulsoryOffering(offering, curriculumSubject)) return 0;

  const where: any = {
    termId: offering.termId,
    effectiveFrom: { lte: offering.term.endDate },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: offering.term.startDate } }],
  };
  if (offering.audienceScope !== 'SCHOOL') where.classCohortId = offering.classCohortId;
  if (offering.audienceScope === 'SECTION') where.sectionId = offering.sectionId;

  const placements = await client.enrollmentPlacement.findMany({ where, select: { enrollmentId: true } });
  if (!placements.length) return 0;
  const enrollmentIds = [...new Set(placements.map((p: any) => p.enrollmentId))] as string[];
  const onRoster = await client.courseEnrollment.count({
    where: { courseOfferingId: offering.id, studentEnrollmentId: { in: enrollmentIds } },
  });
  return Math.max(0, enrollmentIds.length - onRoster);
}
