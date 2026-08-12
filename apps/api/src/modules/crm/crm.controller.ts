import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { CrmService } from './crm.service';
import { CrmAnalyticsService } from './crm-analytics.service';

const DEAL_STAGE_VALUES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
const ACTIVITY_TYPE_VALUES = ['call', 'email', 'meeting', 'note', 'task'] as const;
const ACTIVITY_STATUS_VALUES = ['todo', 'in_progress', 'done', 'cancelled'] as const;

class CreateDealDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsString() partnerId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() ownerId?: string;
  @ApiProperty({ required: false, default: 'lead' })
  @IsOptional() @IsIn(DEAL_STAGE_VALUES)
  stage?: (typeof DEAL_STAGE_VALUES)[number];
  @ApiProperty({ required: false, default: 0 }) @IsOptional() @IsNumber() amount?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() currencyCode?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() expectedClose?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() notes?: string;
}

class UpdateDealDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
  @ApiProperty({ required: false })
  @IsOptional() @IsIn(DEAL_STAGE_VALUES)
  stage?: (typeof DEAL_STAGE_VALUES)[number];
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() amount?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() expectedClose?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() notes?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() ownerId?: string;
}

class CreateActivityDto {
  @ApiProperty({ enum: ACTIVITY_TYPE_VALUES })
  @IsIn(ACTIVITY_TYPE_VALUES)
  type!: (typeof ACTIVITY_TYPE_VALUES)[number];
  @ApiProperty() @IsString() title!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() body?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() subjectType?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() subjectId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() dealId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() partnerId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() dueAt?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() duration?: number;
}

class UpdateActivityDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() title?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() body?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() dueAt?: string;
  @ApiProperty({ required: false, enum: ACTIVITY_STATUS_VALUES })
  @IsOptional() @IsIn(ACTIVITY_STATUS_VALUES)
  status?: (typeof ACTIVITY_STATUS_VALUES)[number];
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() completed?: boolean;
}

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm/deals')
export class DealsController {
  constructor(private readonly svc: CrmService) {}

  @Get()
  @RequirePermissions('crm:deal:read')
  list(
    @Query('stage') stage?: string,
    @Query('partnerId') partnerId?: string,
    @Query('ownerId') ownerId?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.listDeals({
      stage,
      partnerId,
      ownerId,
      q,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /** Archived (soft-deleted) deals — must be declared before @Get(':id'). */
  @Get('deleted')
  @RequirePermissions('crm:deal:read')
  listDeleted() {
    return this.svc.listDeletedDeals();
  }

  @Get(':id')
  @RequirePermissions('crm:deal:read')
  findOne(@Param('id') id: string) {
    return this.svc.findDeal(id);
  }

  @Post()
  @RequirePermissions('crm:deal:write')
  create(@Body() dto: CreateDealDto) {
    return this.svc.createDeal(dto);
  }

  @Patch(':id')
  @RequirePermissions('crm:deal:write')
  update(@Param('id') id: string, @Body() dto: UpdateDealDto) {
    return this.svc.updateDeal(id, dto);
  }

  @Patch(':id/stage')
  @RequirePermissions('crm:deal:write')
  changeStage(
    @Param('id') id: string,
    @Body() body: { stage: (typeof DEAL_STAGE_VALUES)[number] },
  ) {
    return this.svc.changeStage(id, body.stage);
  }

  @Patch(':id/restore')
  @RequirePermissions('crm:deal:write')
  restore(@Param('id') id: string) {
    return this.svc.restoreDeal(id);
  }

  @Delete(':id')
  @RequirePermissions('crm:deal:write')
  remove(@Param('id') id: string) {
    return this.svc.removeDeal(id);
  }
}

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm/activities')
export class ActivitiesController {
  constructor(private readonly svc: CrmService) {}

  @Get()
  @RequirePermissions('crm:activity:read')
  list(
    @Query('type') type?: string,
    @Query('dealId') dealId?: string,
    @Query('partnerId') partnerId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.listActivities({
      type,
      dealId,
      partnerId,
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('upcoming')
  @RequirePermissions('crm:activity:read')
  upcoming(@Query('limit') limit?: string) {
    return this.svc.upcomingTasks(Number(limit ?? 20));
  }

  /** Archived (soft-deleted) activities. */
  @Get('deleted')
  @RequirePermissions('crm:activity:read')
  listDeleted() {
    return this.svc.listDeletedActivities();
  }

  @Post()
  @RequirePermissions('crm:activity:write')
  create(@Body() dto: CreateActivityDto) {
    return this.svc.createActivity(dto);
  }

  @Patch(':id')
  @RequirePermissions('crm:activity:write')
  update(@Param('id') id: string, @Body() dto: UpdateActivityDto) {
    return this.svc.updateActivity(id, dto);
  }

  @Post(':id/complete')
  @RequirePermissions('crm:activity:write')
  complete(@Param('id') id: string) {
    return this.svc.completeActivity(id);
  }

  @Patch(':id/restore')
  @RequirePermissions('crm:activity:write')
  restore(@Param('id') id: string) {
    return this.svc.restoreActivity(id);
  }

  @Delete(':id')
  @RequirePermissions('crm:activity:write')
  remove(@Param('id') id: string) {
    return this.svc.removeActivity(id);
  }
}

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm/analytics')
export class CrmAnalyticsController {
  constructor(private readonly svc: CrmAnalyticsService) {}

  @Get('pipeline')
  @RequirePermissions('crm:dashboard:read')
  pipeline() {
    return this.svc.getPipeline();
  }

  @Get('win-rate')
  @RequirePermissions('crm:dashboard:read')
  winRate(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.getWinRate(from, to);
  }

  @Get('forecast')
  @RequirePermissions('crm:dashboard:read')
  forecast(@Query('months') months?: string) {
    return this.svc.getForecast(months ? Number(months) : undefined);
  }

  @Get('top-customers')
  @RequirePermissions('crm:dashboard:read')
  topCustomers(@Query('limit') limit?: string) {
    return this.svc.getTopCustomers(limit ? parseInt(limit, 10) : 10);
  }

  /** C1 — Partner 360 spend stats (used by the CRM tab on partner pages). */
  @Get('partner/:partnerId')
  @RequirePermissions('crm:deal:read')
  partner360(@Param('partnerId') partnerId: string) {
    return this.svc.getPartner360(partnerId);
  }
}
