/**
 * Phase 5 contracts that need no database.
 *
 * The examination lifecycle, the request shapes the console posts, and the
 * permission split that keeps running an examination, holding its papers,
 * marking it and deciding a promotion four separate acts.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { PERMISSIONS, ALL_PERMISSIONS, EVENTS } from '@erp/shared';
import {
  AllocateScriptsDto, DecideConsiderationDto, DrawModerationSampleDto, ExamLifecycleActionDto,
  EXAM_LIFECYCLE_STATES, RaiseIncidentDto, RecordAttendanceDto, RecordCustodyDto,
  RecordModerationDto, RequestConsiderationDto, ResolveIncidentDto, SubmitScriptMarkDto,
} from '../../src/modules/school/examinations/exam-operations.dto';
import { GenerateReportDocumentsDto, PublishReportDocumentsDto } from '../../src/modules/school/examinations/report-document.dto';
import { ApplyPromotionDto, DecidePromotionDto, ProposePromotionsDto } from '../../src/modules/school/assessment/promotion-decision.dto';

/**
 * Flatten a validation result to `property:constraint` strings.
 *
 * Nested `@ValidateNested` failures live on `children`, not on the parent's
 * `constraints` — so a bad row inside a batch is reported as
 * `rows.0.status:isIn`, which is what a client actually has to fix.
 */
const flatten = (list: ValidationError[], prefix = ''): string[] =>
  list.flatMap((e) => {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    return [
      ...Object.keys(e.constraints ?? {}).map((k) => `${path}:${k}`),
      ...flatten(e.children ?? [], path),
    ];
  });

const errors = <T extends object>(cls: new () => T, payload: unknown): string[] =>
  flatten(validateSync(plainToInstance(cls, payload as object) as object, { whitelist: true }));

describe('Phase 5 — examination lifecycle contract', () => {
  it('names every state the console can render, in order', () => {
    expect(EXAM_LIFECYCLE_STATES).toEqual([
      'draft', 'setup', 'scheduled', 'candidates_locked', 'in_progress',
      'marking', 'moderation', 'results_ready', 'closed', 'archived',
    ]);
  });

  it('accepts a target state and rejects an invented one', () => {
    expect(errors(ExamLifecycleActionDto, { target: 'marking' })).toEqual([]);
    expect(errors(ExamLifecycleActionDto, { target: 'finished' })).toContain('target:isIn');
  });

  it('carries the version the caller believes it is acting on', () => {
    expect(errors(ExamLifecycleActionDto, { target: 'closed', expectedVersion: 3, reason: 'Corrected' })).toEqual([]);
    expect(errors(ExamLifecycleActionDto, { target: 'closed', expectedVersion: 'three' })).toContain('expectedVersion:isInt');
  });
});

describe('Phase 5 — request shapes', () => {
  it('requires at least one attendance row and a known status', () => {
    expect(errors(RecordAttendanceDto, { rows: [] })).toContain('rows:arrayNotEmpty');
    expect(errors(RecordAttendanceDto, { rows: [{ studentProfileId: 's1', status: 'present' }] })).toEqual([]);
    expect(errors(RecordAttendanceDto, { rows: [{ studentProfileId: 's1', status: 'here' }] })).toContain('rows.0.status:isIn');
  });

  it('caps a register at a class-sized batch rather than an unbounded one', () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ studentProfileId: `s${i}`, status: 'present' }));
    expect(errors(RecordAttendanceDto, { rows })).toContain('rows:arrayMaxSize');
  });

  it('an incident needs a description, and closing one needs a written outcome', () => {
    expect(errors(RaiseIncidentDto, { examId: 'e1', type: 'malpractice' })).toContain('description:isNotEmpty');
    expect(errors(ResolveIncidentDto, { status: 'resolved' })).toContain('resolution:isNotEmpty');
    expect(errors(ResolveIncidentDto, { status: 'resolved', resolution: 'Upheld', upholdMalpractice: true })).toEqual([]);
  });

  it('an access arrangement needs a reason, and a decision is approve or refuse', () => {
    expect(errors(RequestConsiderationDto, { examId: 'e1', studentProfileId: 's1', type: 'extra_time' })).toContain('reason:isNotEmpty');
    expect(errors(DecideConsiderationDto, { status: 'maybe' })).toContain('status:isIn');
    expect(errors(DecideConsiderationDto, { status: 'rejected', decisionNote: 'No evidence' })).toEqual([]);
  });

  it('a custody entry is one of the recognised movements', () => {
    expect(errors(RecordCustodyDto, { action: 'sealed', sealNumber: 'S1', copies: 40 })).toEqual([]);
    expect(errors(RecordCustodyDto, { action: 'lost' })).toContain('action:isIn');
    expect(errors(RecordCustodyDto, { action: 'printed', copies: -1 })).toContain('copies:min');
  });

  it('an allocation names its markers, and a mark carries its expected version', () => {
    expect(errors(AllocateScriptsDto, { markerIds: [] })).toContain('markerIds:arrayNotEmpty');
    expect(errors(AllocateScriptsDto, { markerIds: ['u1', 'u2'] })).toEqual([]);
    expect(errors(SubmitScriptMarkDto, { score: 61, expectedVersion: 2 })).toEqual([]);
    expect(errors(SubmitScriptMarkDto, { score: -1 })).toContain('score:min');
  });

  it('a moderation draw is reproducible and its re-marks are bounded', () => {
    expect(errors(DrawModerationSampleDto, { method: 'stratified', sampleSize: 5, seed: 'abc' })).toEqual([]);
    expect(errors(DrawModerationSampleDto, { method: 'vibes' })).toContain('method:isIn');
    expect(errors(RecordModerationDto, { items: [] })).toContain('items:arrayNotEmpty');
    expect(errors(RecordModerationDto, { items: [{ studentProfileId: 's1', moderatedScore: 55 }] })).toEqual([]);
  });

  it('report documents are issued from a result set and released by id', () => {
    expect(errors(GenerateReportDocumentsDto, {})).toContain('resultSetId:isNotEmpty');
    expect(errors(GenerateReportDocumentsDto, { resultSetId: 'rs1', reissue: true, reason: 'Corrected mark' })).toEqual([]);
    expect(errors(PublishReportDocumentsDto, { documentIds: [] })).toContain('documentIds:arrayNotEmpty');
  });

  it('a promotion decision is proposed, decided and applied through three shapes', () => {
    expect(errors(ProposePromotionsDto, {})).toContain('resultSetId:isNotEmpty');
    expect(errors(DecidePromotionDto, { rows: [{ id: 'd1', status: 'approved', decision: 'promote', toClassId: 'c2', toSectionId: 'sec1' }] })).toEqual([]);
    expect(errors(DecidePromotionDto, { rows: [{ id: 'd1', status: 'moved' }] })).toContain('rows.0.status:isIn');
    expect(errors(ApplyPromotionDto, { resultSetId: 'rs1', toTermId: 't2' })).toEqual([]);
  });
});

describe('Phase 5 — authorization split', () => {
  const grants = [
    PERMISSIONS.school.runExamOperations,
    PERMISSIONS.school.manageExamCustody,
    PERMISSIONS.school.allocateScripts,
    PERMISSIONS.school.markScripts,
    PERMISSIONS.school.grantSpecialConsideration,
    PERMISSIONS.school.manageReportDocuments,
    PERMISSIONS.school.publishReportDocuments,
    PERMISSIONS.school.decidePromotion,
    PERMISSIONS.school.applyPromotion,
  ];

  it('every Phase 5 grant is in the catalog, so the routes are actually grantable', () => {
    for (const grant of grants) expect(ALL_PERMISSIONS).toContain(grant);
  });

  it('running an examination, holding its papers, marking it and deciding a promotion are distinct grants', () => {
    expect(new Set(grants).size).toBe(grants.length);
    // Marking is not the same grant as allocating: a marker must not be able to
    // hand themselves a second read of a script they already marked.
    expect(PERMISSIONS.school.markScripts).not.toBe(PERMISSIONS.school.allocateScripts);
    // Issuing a report card is not releasing it, and deciding a promotion is not
    // applying it — the second half of each pair moves something irreversible.
    expect(PERMISSIONS.school.manageReportDocuments).not.toBe(PERMISSIONS.school.publishReportDocuments);
    expect(PERMISSIONS.school.decidePromotion).not.toBe(PERMISSIONS.school.applyPromotion);
  });

  it('publishes an event for every act the exam office takes', () => {
    for (const name of [
      'SchoolExamLifecycleChanged', 'SchoolExamCandidatesFrozen', 'SchoolExamAttendanceRecorded',
      'SchoolExamIncidentRaised', 'SchoolExamIncidentResolved', 'SchoolSpecialConsiderationDecided',
      'SchoolQuestionPaperCustodyRecorded', 'SchoolScriptsAllocated', 'SchoolScriptReconciled',
      'SchoolModerationSampleDrawn', 'SchoolModerationCompleted',
      'SchoolReportDocumentGenerated', 'SchoolReportDocumentPublished', 'SchoolReportDocumentSuperseded',
      'SchoolPromotionProposed', 'SchoolPromotionDecided', 'SchoolPromotionApplied',
      'SchoolResultsAmendmentRejected',
    ] as const) {
      expect(EVENTS[name]).toMatch(/^school\./);
    }
  });
});
