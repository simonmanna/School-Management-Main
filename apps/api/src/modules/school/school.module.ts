import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { WorkflowRegistry } from '../../kernel/workflow/workflow.registry';
import { PERMISSIONS } from '@erp/shared';

import { FoundationModule } from './foundation/foundation.module';
import { PeopleModule } from './people/people.module';
import { AdmissionsModule } from './admissions/admissions.module';
import { AcademicsModule } from './academics/academics.module';
import { AttendanceModule } from './attendance/attendance.module';
import { LmsModule } from './lms/lms.module';
import { ExaminationsModule } from './examinations/examinations.module';
import { FeesModule } from './fees/fees.module';
import { PortalsModule } from './portals/portals.module';
import { LibraryModule } from './library/library.module';
import { TransportModule } from './transport/transport.module';
import { HostelModule } from './hostel/hostel.module';
import { CafeteriaModule } from './cafeteria/cafeteria.module';
import { ReportingModule } from './reporting/reporting.module';
import { SchoolService } from './school.service';
import { SchoolController } from './school.controller';

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
    AdmissionsModule,
    AcademicsModule,
    AttendanceModule,
    LmsModule,
    ExaminationsModule,
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
    ReportingModule,
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
        { from: 'submitted',    to: 'under_review',   action: 'review',         permission: 'school:admissions:write' },
        { from: 'under_review', to: 'exam_scheduled', action: 'schedule_exam',  permission: 'school:admissions:write' },
        { from: 'under_review', to: 'accepted',       action: 'accept',         permission: 'school:admissions:write' },
        { from: 'exam_scheduled',to: 'accepted',       action: 'accept',         permission: 'school:admissions:write' },
        { from: 'exam_scheduled',to: 'rejected',       action: 'reject',         permission: 'school:admissions:write' },
        { from: 'under_review', to: 'rejected',       action: 'reject',         permission: 'school:admissions:write' },
        { from: 'accepted',     to: 'enrolled',       action: 'enroll',         permission: 'school:admissions:write' },
        { from: 'submitted',    to: 'withdrawn',      action: 'withdraw',       permission: 'school:admissions:write' },
        { from: 'under_review', to: 'withdrawn',      action: 'withdraw',       permission: 'school:admissions:write' },
        { from: 'accepted',     to: 'withdrawn',      action: 'withdraw',       permission: 'school:admissions:write' },
      ],
    });

    // Lesson plan lifecycle
    this.workflows.register({
      documentType: 'lesson_plan',
      initial: 'draft',
      transitions: [
        { from: 'draft',     to: 'published', action: 'publish',    permission: 'school:foundation:write' },
        { from: 'published', to: 'draft',     action: 'unpublish', permission: 'school:foundation:write' },
      ],
    });

    // Exam lifecycle
    this.workflows.register({
      documentType: 'exam',
      initial: 'draft',
      transitions: [
        { from: 'draft',     to: 'scheduled', action: 'schedule', permission: 'school:grades:write' },
        { from: 'scheduled', to: 'published', action: 'publish',  permission: 'school:grades:write' },
        { from: 'published', to: 'closed',    action: 'close',    permission: 'school:grades:write' },
      ],
    });

    // Grade entry approval
    this.workflows.register({
      documentType: 'grade_entry',
      initial: 'draft',
      transitions: [
        { from: 'draft',    to: 'submitted', action: 'submit',   permission: 'school:grades:write' },
        { from: 'submitted',to: 'approved',  action: 'approve',  permission: 'school:grades:write' },
        { from: 'submitted',to: 'rejected',  action: 'reject',   permission: 'school:grades:write' },
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
  }
}