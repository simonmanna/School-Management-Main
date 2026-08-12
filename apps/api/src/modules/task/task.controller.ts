/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TaskService } from './task.service';
import {
  CreateTaskDto,
  UpdateTaskDto,
  ReorderTaskDto,
  TaskQueryDto,
  CreateCommentDto,
  CreateLabelDto,
  CreateTaskRuleDto,
  CreateTemplateDto,
} from './dto/create-task.dto';
import { RequiresModule } from '../../kernel/module-loader/requires-module.decorator';

@ApiTags('Tasks')
@ApiBearerAuth()
@RequiresModule('task')
@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  // ─── CRUD ────────────────────────────────────────────────────────────

  @Post()
  create(@Body() dto: CreateTaskDto) {
    return this.taskService.create(dto);
  }

  @Get()
  findAll(@Query() query: TaskQueryDto) {
    return this.taskService.findAll(query);
  }

  @Get('dashboard')
  dashboard() {
    return this.taskService.dashboard();
  }

  @Get('labels')
  listLabels() {
    return this.taskService.listLabels();
  }

  @Post('labels')
  createLabel(@Body() dto: CreateLabelDto) {
    return this.taskService.createLabel(dto);
  }

  @Get('templates')
  listTemplates() {
    return this.taskService.listTemplates();
  }

  @Post('templates')
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.taskService.createTemplate(dto);
  }

  @Get('auto-rules')
  listAutoRules() {
    return this.taskService.listAutoRules();
  }

  @Post('auto-rules')
  createAutoRule(@Body() dto: CreateTaskRuleDto) {
    return this.taskService.createAutoRule(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.taskService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.taskService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.taskService.remove(id);
  }

  @Patch(':id/reorder')
  reorder(@Param('id') id: string, @Body() dto: ReorderTaskDto) {
    return this.taskService.reorder(id, dto.status);
  }

  // ─── Checklist ───────────────────────────────────────────────────────

  @Patch(':id/checklist/:itemId')
  toggleChecklist(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body('isCompleted') isCompleted: boolean,
  ) {
    return this.taskService.toggleChecklist(id, itemId, isCompleted);
  }

  // ─── Comments ────────────────────────────────────────────────────────

  @Post(':id/comments')
  addComment(@Param('id') id: string, @Body() dto: CreateCommentDto) {
    return this.taskService.addComment(id, dto);
  }

  // ─── Verification ────────────────────────────────────────────────────

  @Post(':id/verify')
  verify(
    @Param('id') id: string,
    @Body() dto: { verificationMethod: string; verificationNote?: string },
  ) {
    return this.taskService.verify(id, dto);
  }
}
