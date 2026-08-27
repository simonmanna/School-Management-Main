import { Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PortalIdentityService } from '../../../kernel/auth/portal-identity.service';
import { CbtAttemptService, PaperService, QuestionBankService, QuestionService } from './cbt.service';
import {
  AddPaperQuestionDto,
  CreatePaperDto,
  CreateQuestionBankDto,
  CreateQuestionDto,
  SaveResponseDto,
  StartAttemptDto,
  SubmitAttemptDto,
} from './cbt.dto';

@Controller('school/question-banks')
export class QuestionBankController {
  constructor(private readonly banks: QuestionBankService, private readonly questions: QuestionService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.banks.list(q);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageQuestionBank)
  create(@Body() dto: CreateQuestionBankDto) {
    return this.banks.create(dto);
  }

  @Get(':id/questions')
  @RequirePermissions(PERMISSIONS.school.read)
  questionsOf(@Param('id') id: string) {
    return this.questions.list(id);
  }
}

@Controller('school/questions')
export class QuestionController {
  constructor(private readonly service: QuestionService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageQuestionBank)
  create(@Body() dto: CreateQuestionDto) {
    return this.service.createFull(dto);
  }

  @Post(':id/fork')
  @RequirePermissions(PERMISSIONS.school.manageQuestionBank)
  fork(@Param('id') id: string) {
    return this.service.fork(id);
  }
}

@Controller('school/papers')
export class PaperController {
  constructor(private readonly service: PaperService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.authorCbt)
  create(@Body() dto: CreatePaperDto) {
    return this.service.create(dto);
  }

  @Post(':id/questions')
  @RequirePermissions(PERMISSIONS.school.authorCbt)
  addQuestion(@Param('id') id: string, @Body() dto: AddPaperQuestionDto) {
    return this.service.addQuestion(id, dto.questionId, dto.order, dto.marks);
  }
}

@Controller('school/cbt')
export class CbtAttemptController {
  constructor(
    private readonly service: CbtAttemptService,
    private readonly portalIdentity: PortalIdentityService,
  ) {}

  /**
   * Sit a paper.
   *
   * `studentProfileId` used to be taken from the body and trusted, so a pupil
   * could open an attempt in a classmate's name — and, because the attempt is what
   * the grade bridge later scores, have it marked as theirs. The sitter is now the
   * caller; staff may still start an attempt for someone (invigilated re-sits),
   * which their `takeCbt` permission governs.
   */
  @Post('start')
  @RequirePermissions(PERMISSIONS.school.takeCbt)
  start(@Body() dto: StartAttemptDto) {
    const p = this.portalIdentity.principal();
    if (p.kind === 'guardian') throw new ForbiddenException('Guardians cannot sit a quiz');
    if (p.kind === 'student') {
      if (dto.studentProfileId && dto.studentProfileId !== p.studentProfileId) {
        throw new ForbiddenException('You may only sit a quiz as yourself');
      }
      return this.service.start({ ...dto, studentProfileId: p.studentProfileId });
    }
    return this.service.start(dto);
  }

  /** An attempt belongs to one student; only they (or staff) may read it. */
  @Get('attempts/:id')
  @RequirePermissions(PERMISSIONS.school.takeCbt)
  async get(@Param('id') id: string) {
    await this.assertOwns(id);
    return this.service.getForStudent(id);
  }

  @Post('response')
  @RequirePermissions(PERMISSIONS.school.takeCbt)
  async save(@Body() dto: SaveResponseDto) {
    await this.assertOwns(dto.attemptId);
    return this.service.saveResponse(dto);
  }

  @Post('submit')
  @RequirePermissions(PERMISSIONS.school.takeCbt)
  async submit(@Body() dto: SubmitAttemptDto) {
    await this.assertOwns(dto.attemptId);
    return this.service.submit(dto);
  }

  /**
   * Answering into, or reading, someone else's attempt is the same failure as
   * impersonating them — it writes to the record their grade is computed from.
   */
  private async assertOwns(attemptId: string): Promise<void> {
    const owner = await this.service.ownerOf(attemptId);
    if (!owner) return;
    if (!(await this.portalIdentity.canAccessStudent(owner))) {
      throw new ForbiddenException('This attempt belongs to another student');
    }
    // A guardian may see a child's results elsewhere, but never the live paper.
    if (this.portalIdentity.principal().kind === 'guardian') {
      throw new ForbiddenException('Guardians cannot open a quiz attempt');
    }
  }
}
