import { Body, Controller, Post } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PromotionService } from './promotion.service';
import { PromoteStudentDto, RolloverDto } from './promotion.dto';

@Controller('school/promotion')
export class PromotionController {
  constructor(private readonly promotion: PromotionService) {}

  /** Promote one student into the next grade/term (or graduate them). */
  @Post('promote')
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  promote(@Body() dto: PromoteStudentDto) {
    return this.promotion.promote(dto);
  }

  /**
   * Academic-year rollover. Dry-run by default (returns the plan without
   * writing); pass `{ "dryRun": false }` to execute.
   */
  @Post('rollover')
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  rollover(@Body() dto: RolloverDto) {
    return this.promotion.rolloverTerm(dto);
  }
}
