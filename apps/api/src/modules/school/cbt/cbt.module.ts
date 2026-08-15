import { Module } from '@nestjs/common';
import { AssessmentModule } from '../assessment/assessment.module';
import { CbtAttemptService, PaperService, QuestionBankService, QuestionService } from './cbt.service';
import { CbtAttemptController, PaperController, QuestionBankController, QuestionController } from './cbt.controller';

/**
 * CBT engine (A5). Imports AssessmentModule so a submitted attempt's auto-marked
 * total can post to the assessment spine (MarkingService) — CBT is one more mark
 * producer, not a parallel grade store.
 */
@Module({
  imports: [AssessmentModule],
  controllers: [QuestionBankController, QuestionController, PaperController, CbtAttemptController],
  providers: [QuestionBankService, QuestionService, PaperService, CbtAttemptService],
  exports: [QuestionBankService, QuestionService, PaperService, CbtAttemptService],
})
export class CbtModule {}
