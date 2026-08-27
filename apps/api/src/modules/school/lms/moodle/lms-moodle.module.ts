import { Logger, Module, OnModuleInit } from '@nestjs/common';

import { AssessmentModule } from '../../assessment/assessment.module';

import { LmsEventService } from './lms-event.service';

// P0 — context & capability
import { LmsContextService } from './context/context.service';
import { CapabilityService } from './context/capability.service';
import { LmsRolesService } from './context/roles.service';
import { LmsCapabilityGuard } from './context/capability.guard';
import { LmsRolesController } from './context/roles.controller';

// P1 — activity registry & course spine
import { ActivityRegistry } from './activity/activity-registry.service';
import { ActivityTypeSeeder } from './activity/activity-type.seed';
import { CourseService } from './course/course.service';
import { CourseModuleService } from './course/module.service';
import { QuestionBankService } from './course/question-bank.service';
import { LmsCourseController } from './course/course.controller';

// P4 — enrolment, groups, completion
import { EnrolmentService } from './enrolment/enrolment.service';
import { GroupsService } from './groups/groups.service';
import { CompletionService } from './completion/completion.service';

// P5 — grade bridge, availability, gradebook
import { LmsGradeBridgeService } from './grade/grade-bridge.service';
import { AvailabilityService } from './availability/availability.service';
import { LmsOrphanCheckService } from './maintenance/orphan-check.service';
import { ViewEnvelopeService } from './course/view-envelope.service';
import { LearnerService } from './learner/learner.service';
import { LearnerController } from './learner/learner.controller';
import { LmsFileService } from './files/lms-file.service';
import { LmsFileController } from './files/lms-file.controller';
import { LmsNotifyService } from './notify/lms-notify.service';
import { LmsCalendarService } from './reports/lms-calendar.service';
import { CourseBackupService } from './backup/course-backup.service';
import { PackageServeService } from './packages/package-serve.service';
import { PackageServeController } from './packages/package-serve.controller';
import { LtiService } from './lti/lti.service';
import { LtiController } from './lti/lti.controller';
import { GradebookService } from './gradebook/gradebook.service';

// P7 — reports, badges, plan bridge
import { LmsReportsService } from './reports/reports.service';
import { BadgesService } from './badges/badges.service';
import { PlanPublishService } from './bridge/plan-publish.service';

import { LmsOpsController } from './lms-ops.controller';

// Activity plugins (P2/P3/P6/P8)
import { CONTENT_PLUGINS } from './plugins/content.plugins';
import { ADAPTER_PLUGINS } from './plugins/adapters.plugins';
import { QUIZ_PLUGINS } from './plugins/quiz.plugin';
import { INTERACTIVE_PLUGINS } from './plugins/interactive.plugins';
import { STANDARDS_PLUGINS } from './plugins/standards.plugins';

const CORE_SERVICES = [
  LmsEventService,
  LmsContextService,
  CapabilityService,
  LmsRolesService,
  LmsCapabilityGuard,
  ActivityRegistry,
  ActivityTypeSeeder,
  CourseService,
  CourseModuleService,
  QuestionBankService,
  EnrolmentService,
  GroupsService,
  CompletionService,
  LmsGradeBridgeService,
  AvailabilityService,
  LmsOrphanCheckService,
  ViewEnvelopeService,
  LearnerService,
  LmsFileService,
  LmsNotifyService,
  LmsCalendarService,
  CourseBackupService,
  PackageServeService,
  LtiService,
  GradebookService,
  LmsReportsService,
  BadgesService,
  PlanPublishService,
];

const PLUGINS = [
  ...CONTENT_PLUGINS,
  ...ADAPTER_PLUGINS,
  ...QUIZ_PLUGINS,
  ...INTERACTIVE_PLUGINS,
  ...STANDARDS_PLUGINS,
];

/**
 * The Moodle-shaped LMS (ADR-014). One module wiring the context/capability system,
 * the course spine, the activity-plugin registry and every plugin. Registered under
 * the school vertical alongside the existing (Phase-1) LMS modules.
 */
@Module({
  // AssessmentModule supplies MarkingService — the grade bridge posts marks
  // through its ledger rather than writing the derived score columns itself.
  imports: [AssessmentModule],
  controllers: [LmsCourseController, LmsOpsController, LmsRolesController, LearnerController, LmsFileController, PackageServeController, LtiController],
  providers: [...CORE_SERVICES, ...PLUGINS],
  exports: [...CORE_SERVICES],
})
export class LmsMoodleModule implements OnModuleInit {
  private readonly logger = new Logger('LmsMoodleModule');

  constructor(private readonly activityTypes: ActivityTypeSeeder) {}

  async onModuleInit(): Promise<void> {
    // Plugins have self-registered by now; reconcile the LmsActivityType catalog.
    try {
      await this.activityTypes.sync();
    } catch (err) {
      this.logger.warn(`Activity-type sync deferred (will run on first use): ${String(err)}`);
    }
  }
}
