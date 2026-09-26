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
  /** Memberships ended because the learner's seat no longer covers them (F11). */
  closedOfferingIds: string[];
  /** Chosen (elective/remedial/manual) memberships with no equivalent in the new seat. */
  needsReviewOfferingIds: string[];
}

/** Marks a membership the system ended, so the system may reopen it (F11). */
export const SYSTEM_CLOSED_PREFIX = 'SYSTEM:';

/**
 * End every open course membership of an annual enrollment — the learner has
 * left (withdrawn, transferred, completed). History stays: the row keeps its
 * dates and frozen rosters keep their members (F11).
 */
export async function closeCourseMembershipsInTx(
  tx: any,
  args: { enrollmentId: string; at: Date; reason: string; actorId?: string | null },
): Promise<number> {
  const res = await tx.courseEnrollment.updateMany({
    where: { studentEnrollmentId: args.enrollmentId, status: 'ENROLLED' },
    data: { status: 'WITHDRAWN', endDate: args.at, withdrawalReason: `${SYSTEM_CLOSED_PREFIX} ${args.reason}`, updatedBy: args.actorId ?? null },
  });
  return res.count;
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
  // Offerings are keyed by cohort; older ones only by class. Both cover a seat.
  const cohortClassId = target.classCohortId
    ? (await tx.classCohort.findFirst({ where: { id: target.classCohortId }, select: { classId: true } }))?.classId ?? null
    : null;
  // A SECTION-scoped offering only covers learners in that stream.
  const audience = [{ audienceScope: 'COHORT' }, { audienceScope: 'SECTION', sectionId: target.sectionId }];
  const offerings: ReconcilableOffering[] = await tx.courseOffering.findMany({
    where: {
      organizationId: target.organizationId,
      termId: target.termId,
      deletedAt: null,
      status: { not: 'ARCHIVED' },
      audienceScope: { not: 'CUSTOM' },
      OR: [
        { audienceScope: 'SCHOOL' },
        ...(target.classCohortId ? [{ classCohortId: target.classCohortId, OR: audience }] : []),
        ...(cohortClassId ? [{ classCohortId: null, classId: cohortClassId, OR: audience }] : []),
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
  const offeringIds: string[] = [];
  const closedOfferingIds: string[] = [];
  const needsReviewOfferingIds: string[] = [];
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
      select: { id: true, source: true, status: true, withdrawalReason: true },
    });
    if (existing) {
      // A membership the system ended when the learner moved away is theirs
      // again when they move back. A deliberate opt-out or withdrawal is not.
      if (existing.status === 'WITHDRAWN' && String(existing.withdrawalReason ?? '').startsWith(SYSTEM_CLOSED_PREFIX)) {
        await tx.courseEnrollment.updateMany({
          where: { id: existing.id },
          data: { status: 'ENROLLED', startDate: target.effectiveFrom, endDate: null, withdrawalReason: null, updatedBy: target.actorId ?? null },
        });
        offeringIds.push(offering.id);
      }
      continue;
    }

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

  // F11: memberships this seat no longer covers. Adding the new class's
  // courses without leaving the old ones kept a moved learner on North's
  // register and let a North assessment capture them under South.
  const covering = new Set(offerings.map((o) => o.id));
  const open = await tx.courseEnrollment.findMany({
    where: {
      studentEnrollmentId: target.enrollmentId,
      status: 'ENROLLED',
      courseOffering: { termId: target.termId, deletedAt: null },
    },
    select: {
      id: true,
      source: true,
      courseOfferingId: true,
      courseOffering: { select: { audienceScope: true, subjectId: true, offeringType: true, effectiveFrom: true } },
    },
  });
  for (const m of open) {
    if (covering.has(m.courseOfferingId)) continue;
    const scope = m.courseOffering?.audienceScope;
    // School-wide courses cover every seat; a CUSTOM group was chosen by hand.
    if (scope === 'SCHOOL' || scope === 'CUSTOM') continue;
    const close = () =>
      tx.courseEnrollment.updateMany({
        where: { id: m.id },
        data: {
          status: 'WITHDRAWN',
          endDate: target.effectiveFrom,
          withdrawalReason: `${SYSTEM_CLOSED_PREFIX} moved to another class or stream`,
          updatedBy: target.actorId ?? null,
        },
      });
    if (m.source === 'COMPULSORY') {
      await close();
      closedOfferingIds.push(m.courseOfferingId);
      continue;
    }
    // A chosen course (elective, remedial, manual): follow the learner to the
    // same subject in the new seat where one exists; otherwise a person decides.
    const equivalent = offerings.find(
      (o) => o.subjectId && o.subjectId === m.courseOffering?.subjectId && o.offeringType === m.courseOffering?.offeringType,
    );
    if (!equivalent) {
      needsReviewOfferingIds.push(m.courseOfferingId);
      continue;
    }
    await close();
    closedOfferingIds.push(m.courseOfferingId);
    const already = await tx.courseEnrollment.findUnique({
      where: { courseOfferingId_studentEnrollmentId: { courseOfferingId: equivalent.id, studentEnrollmentId: target.enrollmentId } },
      select: { id: true, status: true },
    });
    if (!already) {
      await tx.courseEnrollment.create({
        data: {
          organizationId: target.organizationId,
          courseOfferingId: equivalent.id,
          studentEnrollmentId: target.enrollmentId,
          source: m.source,
          status: 'ENROLLED',
          startDate: target.effectiveFrom > equivalent.effectiveFrom ? target.effectiveFrom : equivalent.effectiveFrom,
          createdBy: target.actorId ?? null,
        },
      });
      offeringIds.push(equivalent.id);
    } else if (already.status !== 'ENROLLED') {
      await tx.courseEnrollment.updateMany({
        where: { id: already.id },
        data: { status: 'ENROLLED', startDate: target.effectiveFrom, endDate: null, withdrawalReason: null, updatedBy: target.actorId ?? null },
      });
      offeringIds.push(equivalent.id);
    }
  }

  return {
    enrolled: offeringIds.length,
    considered: offerings.length,
    offeringIds,
    closedOfferingIds,
    needsReviewOfferingIds,
  };
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
  if (offering.audienceScope !== 'SCHOOL') {
    if (offering.classCohortId) where.classCohortId = offering.classCohortId;
    else if ((offering as any).classId) where.classCohort = { classId: (offering as any).classId };
    else return 0;
  }
  if (offering.audienceScope === 'SECTION') where.sectionId = offering.sectionId;

  const placements = await client.enrollmentPlacement.findMany({ where, select: { enrollmentId: true } });
  if (!placements.length) return 0;
  const enrollmentIds = [...new Set(placements.map((p: any) => p.enrollmentId))] as string[];
  const onRoster = await client.courseEnrollment.count({
    where: { courseOfferingId: offering.id, studentEnrollmentId: { in: enrollmentIds }, status: 'ENROLLED' },
  });
  return Math.max(0, enrollmentIds.length - onRoster);
}
