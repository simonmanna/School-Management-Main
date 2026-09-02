import { Module } from '@nestjs/common';
import { TeachingController } from './teaching.controller';
import { TeachingAccessService } from './teaching-access.service';
import { SchemeOfWorkService } from './scheme-of-work.service';
import { LessonDeliveryService } from './lesson-delivery.service';
import { TeachingWorkspaceService } from './teaching-workspace.service';

/**
 * Phase 3 — curriculum and teaching delivery.
 *
 * Sits between the Phase 2 offering (the teaching context) and the assessment
 * spine: schemes of work, lesson delivery against the timetable, the evidence a
 * lesson leaves and the follow-up it raises.
 */
@Module({
  controllers: [TeachingController],
  providers: [TeachingAccessService, SchemeOfWorkService, LessonDeliveryService, TeachingWorkspaceService],
  exports: [TeachingAccessService, SchemeOfWorkService, LessonDeliveryService, TeachingWorkspaceService],
})
export class TeachingModule {}
