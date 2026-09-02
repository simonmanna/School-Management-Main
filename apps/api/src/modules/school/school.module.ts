import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { WorkflowRegistry } from '../../kernel/workflow/workflow.registry';
import { PERMISSIONS } from '@erp/shared';

import { FoundationModule } from './foundation/foundation.module';
import { PeopleModule } from './people/people.module';
import { SchoolEnrollmentModule } from './enrollment/enrollment.module';
import { CourseOfferingModule } from './course-offerings/course-offering.module';
import { TeachingModule } from './teaching/teaching.module';
import { AdmissionsModule } from './admissions/admissions.module';
import { AcademicsModule } from './academics/academics.module';
import { AttendanceModule } from './attendance/attendance.module';
import { LmsModule } from './lms/lms.module';
import { LessonPlanningModule } from './lms/lesson-planning.module';
import { LmsMoodleModule } from './lms/moodle/lms-moodle.module';
import { ExaminationsModule } from './examinations/examinations.module';
import { AssessmentModule } from './assessment/assessment.module';
import { CbtModule } from './cbt/cbt.module';
import { CertificationModule } from './certification/certification.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { FeesModule } from './fees/fees.module';
import { PortalsModule } from './portals/portals.module';
import { LibraryModule } from './library/library.module';
import { TransportModule } from './transport/transport.module';
import { HostelModule } from './hostel/hostel.module';
import { CafeteriaModule } from './cafeteria/cafeteria.module';
import { MealsModule } from './meals/meals.module';
import { ReportingModule } from './reporting/reporting.module';
import { SchoolReportsModule } from './reporting/school-reports.module';
import { SchoolDocumentsModule } from './documents/school-documents.module';
import { FrontDeskModule } from './front-desk/front-desk.module';
import { SchoolService } from './school.service';
import { SchoolController } from './school.controller';

// The advanced Moodle-shaped delivery layer is unfinished and fail-closed.
// Core offerings, lesson plans, assignments and the canonical assessment spine
// remain available because they are not optional LMS concerns.
const advancedLmsImports = process.env.ENABLE_ADVANCED_LMS === 'true' ? [LmsMoodleModule] : [];

/**
 * School Vertical (ADR-011) — built on the reusable core.
 *
 * All money effects flow through `DocumentBuilderService` and `PostingService`
 * from `invoicing` + `accounting`. All state transitions go through
 * `WorkflowService` from the kernel. Every table added by this module is
 * registered in `ORG_SCOPED` (kernel/prisma/tenancy.extension.ts) so RLS
 * still applies.
 */
@Module({
  imports: [
    FoundationModule,
    PeopleModule,
    SchoolEnrollmentModule,
    CourseOfferingModule,
    TeachingModule,
    AdmissionsModule,
    AcademicsModule,
    AttendanceModule,
    LmsModule,
    LessonPlanningModule,
    ...advancedLmsImports,
    ExaminationsModule,
    AssessmentModule,
    CbtModule,
    CertificationModule,
    AnalyticsModule,
    FeesModule,
    PortalsModule,
    // school/communication was dropped in the port (P0/B2): its Notification
    // and Message models collided with the platform's richer communication
    // module. School services publish domain events; CommunicationRule routes
    // them (wired in P3).
    LibraryModule,
    TransportModule,
    HostelModule,
    CafeteriaModule,
    MealsModule,
    ReportingModule,
    // The registry-driven report centre (ADR-017). Mounted alongside the
    // dashboard-tile ReportingModule, which the web dashboard still consumes.
    SchoolReportsModule,
    SchoolDocumentsModule,
    FrontDeskModule,
  ],
  controllers: [SchoolController],
  providers: [SchoolService],
  exports: [SchoolService],
})
export class SchoolModule implements OnModuleInit {
  constructor(
    private readonly registry: ModuleRegistry,
    private readonly workflows: WorkflowRegistry,
  ) {}

  onModuleInit(): void {
    // Manifest — kernel validates the dependency graph at boot (ADR-005).
    this.registry.register({
      name: 'school',
      version: '1.0.0',
      dependencies: ['core', 'accounting', 'invoicing', 'inventory'],
      permissions: Object.values(PERMISSIONS.school),
    });

    // Workflow definitions — registered here so the WorkflowService can resolve
    // them. Each sprint's module may register additional ones; this is the
    // shared set every deploy needs.
    this.registerWorkflows();
  }

  /**
   * One-shot registration of every school workflow definition.
   * The engine (kernel/workflow/workflow.service.ts) consults the registry on
   * every transition; the registry holds the static state machine.
   */
  private registerWorkflows(): void {
    // Admission lifecycle (school-specific states use string literals; engine
    // accepts any string as a valid `WorkflowState`).
    this.workflows.register({
      documentType: 'admission_application',
      initial: 'submitted',
      transitions: [
        { from: 'submitted',    to: 'under_review', action: 'review',               permission: 'school:admissions:write' },
        { from: 'under_review', to: 'screening', action: 'screen',               permission: 'school:admissions:write' },
        { from: 'under_review', to: 'exam_scheduled', action: 'schedule_exam',    permission: 'school:admissions:write' },
        { from: 'under_review', to: 'accepted',     action: 'accept',             permission: 'school:admissions:write' },
        { from: 'under_review', to: 'rejected',     action: 'reject',               permission: 'school:admissions:write' },
        { from: 'screening',    to: 'interview_scheduled', action: 'schedule_interview', permission: 'school:admissions:write' },
        { from: 'screening',    to: 'exam_scheduled', action: 'schedule_exam',      permission: 'school:admissions:write' },
        { from: 'screening',    to: 'rejected',     action: 'reject',               permission: 'school:admissions:write' },
        { from: 'interview_scheduled', to: 'interview_scheduled', action: 'schedule_interview', permission: 'school:admissions:write' },
        { from: 'interview_scheduled', to: 'interviewed', action: 'complete_interview', permission: 'school:admissions:write' },
        { from: 'interview_scheduled', to: 'interview_scheduled', action: 'reschedule', permission: 'school:admissions:write' },
        { from: 'interview_scheduled', to: 'rejected', action: 'reject',            permission: 'school:admissions:write' },
        { from: 'interviewed', to: 'exam_scheduled', action: 'schedule_exam',       permission: 'school:admissions:write' },
        { from: 'interviewed', to: 'interviewed', action: 'exam_done',             permission: 'school:admissions:write' },
        { from: 'interviewed', to: 'scored',     action: 'score',                  permission: 'school:admissions:write' },
        { from: 'interviewed', to: 'accepted',    action: 'accept',                permission: 'school:admissions:write' },
        { from: 'interviewed', to: 'rejected',    action: 'reject',               permission: 'school:admissions:write' },
        { from: 'exam_scheduled', to: 'interviewed', action: 'exam_done',          permission: 'school:admissions:write' },
        { from: 'exam_scheduled', to: 'accepted', action: 'accept',                permission: 'school:admissions:write' },
        { from: 'exam_scheduled', to: 'rejected', action: 'reject',                permission: 'school:admissions:write' },
        { from: 'scored', to: 'accepted', action: 'accept',                        permission: 'school:admissions:write' },
        { from: 'scored', to: 'rejected', action: 'reject',                        permission: 'school:admissions:write' },
        { from: 'under_review', to: 'rejected', action: 'reject',                  permission: 'school:admissions:write' },
        { from: 'accepted', to: 'waitlisted', action: 'waitlist',                 permission: 'school:admissions:write' },
        { from: 'accepted', to: 'offer_issued', action: 'issue_offer',            permission: 'school:admissions:write' },
        { from: 'waitlisted', to: 'offer_issued', action: 'issue_offer',          permission: 'school:admissions:write' },
        { from: 'offer_issued', to: 'offer_accepted', action: 'accept_offer',      permission: 'school:admissions:write' },
        { from: 'offer_issued', to: 'waitlisted', action: 'decline_offer',         permission: 'school:admissions:write' },
        { from: 'offer_accepted', to: 'enrolled', action: 'enroll',               permission: 'school:admissions:write' },
        { from: 'submitted', to: 'withdrawn', action: 'withdraw',                  permission: 'school:admissions:write' },
        { from: 'under_review', to: 'withdrawn', action: 'withdraw',               permission: 'school:admissions:write' },
        { from: 'screening', to: 'withdrawn', action: 'withdraw',                 permission: 'school:admissions:write' },
        { from: 'interview_scheduled', to: 'withdrawn', action: 'withdraw',        permission: 'school:admissions:write' },
        { from: 'interviewed', to: 'withdrawn', action: 'withdraw',                permission: 'school:admissions:write' },
        { from: 'scored', to: 'withdrawn', action: 'withdraw',                    permission: 'school:admissions:write' },
        { from: 'exam_scheduled', to: 'withdrawn', action: 'withdraw',            permission: 'school:admissions:write' },
        { from: 'accepted', to: 'withdrawn', action: 'withdraw',                  permission: 'school:admissions:write' },
        { from: 'waitlisted', to: 'withdrawn', action: 'withdraw',                permission: 'school:admissions:write' },
        { from: 'offer_issued', to: 'withdrawn', action: 'decline_offer',         permission: 'school:admissions:write' },
      ],
    });

    // Lesson plan lifecycle (Phase 1 — full HOD review FSM; reuse WorkflowService).
    this.workflows.register({
      documentType: 'lesson_plan',
      initial: 'draft',
      transitions: [
        { from: 'draft',          to: 'submitted',       action: 'submit',        permission: 'school:lessonplans:write' },
        { from: 'submitted',      to: 'needs_revision',  action: 'request_change', permission: 'school:lessonplans:approve' },
        { from: 'submitted',      to: 'approved',        action: 'approve',       permission: 'school:lessonplans:approve' },
        { from: 'needs_revision', to: 'submitted',       action: 'resubmit',      permission: 'school:lessonplans:write' },
        { from: 'needs_revision', to: 'draft',           action: 'revert',        permission: 'school:lessonplans:write' },
        { from: 'approved',       to: 'archived',        action: 'archive',       permission: 'school:lessonplans:approve' },
        { from: 'archived',       to: 'draft',           action: 'restore',       permission: 'school:lessonplans:write' },
      ],
    });

    // Curriculum version lifecycle (A0: published versions are immutable; edits
    // create a new version via cloneAsNewVersion).
    this.workflows.register({
      documentType: 'curriculum_version',
      initial: 'draft',
      transitions: [
        { from: 'draft',    to: 'published', action: 'publish', permission: 'school:foundation:write' },
        { from: 'published', to: 'archived', action: 'archive', permission: 'school:foundation:write' },
        { from: 'archived', to: 'draft',    action: 'restore', permission: 'school:foundation:write' },
      ],
    });

    // Exam lifecycle
    this.workflows.register({
      documentType: 'exam',
      initial: 'draft',
      transitions: [
        { from: 'draft',     to: 'scheduled', action: 'schedule', permission: 'school:exams:write' },
        { from: 'scheduled', to: 'published', action: 'publish',  permission: 'school:exams:write' },
        { from: 'published', to: 'closed',    action: 'close',    permission: 'school:exams:write' },
      ],
    });

    // Grade entry approval. A0: entry and approval are deliberately different
    // permissions — the enterer must not be able to approve their own marks.
    this.workflows.register({
      documentType: 'grade_entry',
      initial: 'draft',
      transitions: [
        { from: 'draft',    to: 'submitted', action: 'submit',   permission: 'school:grades:write' },
        { from: 'submitted',to: 'approved',  action: 'approve',  permission: 'school:grades:approve' },
        { from: 'submitted',to: 'rejected',  action: 'reject',   permission: 'school:grades:approve' },
        { from: 'rejected', to: 'submitted', action: 'resubmit', permission: 'school:grades:write' },
      ],
    });

    // Attendance correction
    this.workflows.register({
      documentType: 'attendance_correction',
      initial: 'draft',
      transitions: [
        { from: 'draft', to: 'approved', action: 'approve', permission: 'school:attendance:write' },
        { from: 'draft', to: 'rejected', action: 'reject',  permission: 'school:attendance:write' },
      ],
    });

    // Assessment lifecycle (A1). Services flip status directly (as exam/grade do)
    // — this definition documents the canonical FSM in one discoverable place.
    this.workflows.register({
      documentType: 'assessment',
      initial: 'draft',
      transitions: [
        { from: 'draft',     to: 'scheduled', action: 'schedule', permission: 'school:assessments:write' },
        { from: 'draft',     to: 'published', action: 'publish',  permission: 'school:assessments:write' },
        { from: 'scheduled', to: 'published', action: 'publish',  permission: 'school:assessments:write' },
        { from: 'published', to: 'open',      action: 'open',     permission: 'school:assessments:write' },
        { from: 'published', to: 'closed',    action: 'close',    permission: 'school:assessments:write' },
        { from: 'open',      to: 'closed',    action: 'close',    permission: 'school:assessments:write' },
        { from: 'closed',    to: 'graded',    action: 'grade',    permission: 'school:assessments:write' },
        { from: 'grading',   to: 'graded',    action: 'grade',    permission: 'school:assessments:write' },
        { from: 'graded',    to: 'archived',  action: 'archive',  permission: 'school:assessments:write' },
        { from: 'closed',    to: 'archived',  action: 'archive',  permission: 'school:assessments:write' },
      ],
    });

    // Marking approval for a student's assessment marks — same SoD as grade_entry.
    this.workflows.register({
      documentType: 'student_assessment_marking',
      initial: 'draft',
      transitions: [
        { from: 'draft',     to: 'submitted', action: 'submit',   permission: 'school:grades:write' },
        { from: 'submitted', to: 'approved',  action: 'approve',  permission: 'school:grades:approve' },
        { from: 'submitted', to: 'rejected',  action: 'reject',   permission: 'school:grades:approve' },
        { from: 'rejected',  to: 'submitted', action: 'resubmit', permission: 'school:grades:write' },
      ],
    });
  }
}
