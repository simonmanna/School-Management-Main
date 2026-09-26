import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { CareLogService } from './care-log.service';
import { PickupService } from './pickup.service';
import { IncidentService } from './incident.service';
import { ImmunisationService } from './immunisation.service';
import {
  CreateIncidentDto,
  CreatePickupAuthorizationDto,
  NotifyGuardianDto,
  ReleaseChildDto,
  ReviewIncidentDto,
  RevokePickupAuthorizationDto,
  UpsertCareLogDto,
  UpsertImmunisationDto,
} from './dto.types';

@Controller('school/care-logs')
export class CareLogController {
  constructor(private readonly service: CareLogService) {}

  /** The room's day: every child placed in the class, with today's log or a blank. */
  @Get('class/:classId')
  @RequirePermissions(PERMISSIONS.school.read)
  forClass(
    @Param('classId') classId: string,
    @Query('onDate') onDate: string,
    @Query('sectionId') sectionId?: string,
  ) {
    return this.service.forClass(classId, onDate ?? new Date().toISOString(), sectionId);
  }

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  forStudent(
    @Param('studentProfileId') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.forStudent(id, { from, to });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageCareLogs)
  upsert(@Body() dto: UpsertCareLogDto) {
    return this.service.upsert(dto);
  }

  @Post(':id/share')
  @RequirePermissions(PERMISSIONS.school.manageCareLogs)
  share(@Param('id') id: string) {
    return this.service.setShared(id, true);
  }

  @Post(':id/unshare')
  @RequirePermissions(PERMISSIONS.school.manageCareLogs)
  unshare(@Param('id') id: string) {
    return this.service.setShared(id, false);
  }
}

@Controller('school/pickup')
export class PickupController {
  constructor(private readonly service: PickupService) {}

  /** Everyone who may collect this child right now — guardians and authorizations. */
  @Get('who-may-collect/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  whoMayCollect(@Param('studentProfileId') id: string, @Query('at') at?: string) {
    return this.service.whoMayCollect(id, at);
  }

  @Get('authorizations/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.managePickup)
  history(@Param('studentProfileId') id: string) {
    return this.service.history(id);
  }

  @Post('authorizations')
  @RequirePermissions(PERMISSIONS.school.managePickup)
  create(@Body() dto: CreatePickupAuthorizationDto) {
    return this.service.create(dto);
  }

  @Patch('authorizations/:id/revoke')
  @RequirePermissions(PERMISSIONS.school.managePickup)
  revoke(@Param('id') id: string, @Body() dto: RevokePickupAuthorizationDto) {
    return this.service.revoke(id, dto);
  }

  /** The gate action: this child left with this adult. */
  @Post('release')
  @RequirePermissions(PERMISSIONS.school.releaseChild)
  release(@Body() dto: ReleaseChildDto) {
    return this.service.release(dto);
  }

  @Get('releases')
  @RequirePermissions(PERMISSIONS.school.read)
  releases(@Query('onDate') onDate: string) {
    return this.service.releasesOn(onDate ?? new Date().toISOString());
  }
}

@Controller('school/incidents')
export class ChildIncidentController {
  constructor(private readonly service: IncidentService) {}

  /** Unnotified and unreviewed first — the head teacher's to-do, not a browse. */
  @Get('outstanding')
  @RequirePermissions(PERMISSIONS.school.readIncidents)
  outstanding() {
    return this.service.outstanding();
  }

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.readIncidents)
  forStudent(@Param('studentProfileId') id: string) {
    return this.service.forStudent(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.recordIncidents)
  create(@Body() dto: CreateIncidentDto) {
    return this.service.create(dto);
  }

  @Patch(':id/notified')
  @RequirePermissions(PERMISSIONS.school.recordIncidents)
  notified(@Param('id') id: string, @Body() dto: NotifyGuardianDto) {
    return this.service.notifyGuardian(id, dto);
  }

  /** Deliberately not the recorder's grant. */
  @Patch(':id/review')
  @RequirePermissions(PERMISSIONS.school.reviewIncidents)
  review(@Param('id') id: string, @Body() dto: ReviewIncidentDto) {
    return this.service.review(id, dto);
  }
}

@Controller('school/immunisations')
export class ImmunisationController {
  constructor(private readonly service: ImmunisationService) {}

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  forStudent(@Param('studentProfileId') id: string) {
    return this.service.forStudent(id);
  }

  /** Doses due or overdue, and the children with no record at all. */
  @Get('due/:classId')
  @RequirePermissions(PERMISSIONS.school.read)
  due(
    @Param('classId') classId: string,
    @Query('withinDays') withinDays?: string,
    @Query('sectionId') sectionId?: string,
  ) {
    return this.service.dueForClass(classId, {
      withinDays: withinDays ? Number(withinDays) : undefined,
      sectionId,
    });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageImmunisations)
  upsert(@Body() dto: UpsertImmunisationDto) {
    return this.service.upsert(dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageImmunisations)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
