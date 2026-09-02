import { Module } from '@nestjs/common';
import { CourseOfferingController } from './course-offering.controller';
import { CourseOfferingService } from './course-offering.service';

@Module({
  controllers: [CourseOfferingController],
  providers: [CourseOfferingService],
  exports: [CourseOfferingService],
})
export class CourseOfferingModule {}
