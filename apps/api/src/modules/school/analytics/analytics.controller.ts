import { Controller, Get, Param, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AnalyticsService } from './analytics.service';

/**
 * Academic analytics (A7). All read-only; gated on the dedicated
 * `school:analytics:read` grant (more sensitive than a class list).
 */
@Controller('school/analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('overview/:resultSetId')
  @RequirePermissions(PERMISSIONS.school.readAnalytics)
  overview(@Param('resultSetId') id: string) {
    return this.service.overview(id);
  }

  @Get('grade-distribution/:resultSetId')
  @RequirePermissions(PERMISSIONS.school.readAnalytics)
  gradeDistribution(@Param('resultSetId') id: string) {
    return this.service.gradeDistribution(id);
  }

  @Get('subject-performance/:resultSetId')
  @RequirePermissions(PERMISSIONS.school.readAnalytics)
  subjectPerformance(@Param('resultSetId') id: string, @Query('passMark') passMark?: string) {
    return this.service.subjectPerformance(id, passMark ? Number(passMark) : undefined);
  }

  @Get('class-performance/:resultSetId')
  @RequirePermissions(PERMISSIONS.school.readAnalytics)
  classPerformance(@Param('resultSetId') id: string) {
    return this.service.classPerformance(id);
  }

  @Get('ca-vs-exam/:resultSetId')
  @RequirePermissions(PERMISSIONS.school.readAnalytics)
  caVsExam(@Param('resultSetId') id: string, @Query('threshold') threshold?: string) {
    return this.service.caVsExamDivergence(id, threshold ? Number(threshold) : undefined);
  }

  @Get('at-risk/:resultSetId')
  @RequirePermissions(PERMISSIONS.school.readAnalytics)
  atRisk(@Param('resultSetId') id: string) {
    return this.service.atRisk(id);
  }

  @Get('student-trend/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.readAnalytics)
  studentTrend(@Param('studentProfileId') id: string) {
    return this.service.studentTrend(id);
  }

  @Get('assignment-metrics/:classId/term/:termId')
  @RequirePermissions(PERMISSIONS.school.readAnalytics)
  assignmentMetrics(@Param('classId') classId: string, @Param('termId') termId: string) {
    return this.service.assignmentMetrics(classId, termId);
  }

  @Get('exam-attendance/:examId')
  @RequirePermissions(PERMISSIONS.school.readAnalytics)
  examAttendance(@Param('examId') examId: string) {
    return this.service.examAttendance(examId);
  }
}
