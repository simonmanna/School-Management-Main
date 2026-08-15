import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
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
  constructor(private readonly service: CbtAttemptService) {}

  @Post('start')
  @RequirePermissions(PERMISSIONS.school.takeCbt)
  start(@Body() dto: StartAttemptDto) {
    return this.service.start(dto);
  }

  @Get('attempts/:id')
  @RequirePermissions(PERMISSIONS.school.takeCbt)
  get(@Param('id') id: string) {
    return this.service.getForStudent(id);
  }

  @Post('response')
  @RequirePermissions(PERMISSIONS.school.takeCbt)
  save(@Body() dto: SaveResponseDto) {
    return this.service.saveResponse(dto);
  }

  @Post('submit')
  @RequirePermissions(PERMISSIONS.school.takeCbt)
  submit(@Body() dto: SubmitAttemptDto) {
    return this.service.submit(dto);
  }
}
