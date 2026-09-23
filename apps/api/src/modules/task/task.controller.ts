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
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';

@ApiTags('Tasks')
@ApiBearerAuth()
@RequiresModule('task')
@Controller('tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  // ─── CRUD ────────────────────────────────────────────────────────────

  @Post()
  @RequirePermissions(PERMISSIONS.task.create)
  create(@Body() dto: CreateTaskDto) {
    return this.taskService.create(dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.task.read)
  findAll(@Query() query: TaskQueryDto) {
    return this.taskService.findAll(query);
  }

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.task.read)
  dashboard() {
    return this.taskService.dashboard();
  }

  @Get('labels')
  @RequirePermissions(PERMISSIONS.task.read)
  listLabels() {
    return this.taskService.listLabels();
  }

  @Post('labels')
  @RequirePermissions(PERMISSIONS.task.manageLabels)
  createLabel(@Body() dto: CreateLabelDto) {
    return this.taskService.createLabel(dto);
  }

  @Get('templates')
  @RequirePermissions(PERMISSIONS.task.read)
  listTemplates() {
    return this.taskService.listTemplates();
  }

  @Post('templates')
  @RequirePermissions(PERMISSIONS.task.manageTemplates)
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.taskService.createTemplate(dto);
  }

  @Get('auto-rules')
  @RequirePermissions(PERMISSIONS.task.read)
  listAutoRules() {
    return this.taskService.listAutoRules();
  }

  @Post('auto-rules')
  @RequirePermissions(PERMISSIONS.task.manageAutoRules)
  createAutoRule(@Body() dto: CreateTaskRuleDto) {
    return this.taskService.createAutoRule(dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.task.read)
  findOne(@Param('id') id: string) {
    return this.taskService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.task.update)
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.taskService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.task.delete)
  remove(@Param('id') id: string) {
    return this.taskService.remove(id);
  }

  @Patch(':id/reorder')
  @RequirePermissions(PERMISSIONS.task.reorder)
  reorder(@Param('id') id: string, @Body() dto: ReorderTaskDto) {
    return this.taskService.reorder(id, dto.status);
  }

  // ─── Checklist ───────────────────────────────────────────────────────

  @Patch(':id/checklist/:itemId')
  @RequirePermissions(PERMISSIONS.task.update)
  toggleChecklist(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body('isCompleted') isCompleted: boolean,
  ) {
    return this.taskService.toggleChecklist(id, itemId, isCompleted);
  }

  // ─── Comments ────────────────────────────────────────────────────────

  @Post(':id/comments')
  @RequirePermissions(PERMISSIONS.task.read)
  addComment(@Param('id') id: string, @Body() dto: CreateCommentDto) {
    return this.taskService.addComment(id, dto);
  }

  // ─── Verification ────────────────────────────────────────────────────

  @Post(':id/verify')
  @RequirePermissions(PERMISSIONS.task.verify)
  verify(
    @Param('id') id: string,
    @Body() dto: { verificationMethod: string; verificationNote?: string },
  ) {
    return this.taskService.verify(id, dto);
  }
}
