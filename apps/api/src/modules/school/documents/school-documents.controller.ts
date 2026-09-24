import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { CurrentUser, type AuthUser } from '../../../kernel/auth/decorators/current-user.decorator';
import { SchoolDocumentsService } from './school-documents.service';
import { CreateSchoolDocDto, SignSchoolDocDto, UpdateSchoolDocDto, VerifySchoolDocDto } from './school-documents.dto';

// Gated on the documents grants, not `school:read`: every staff preset holds
// school:read, so the librarian and the cook could list every pupil's and
// staff member's documents register (E2E audit D2).
@Controller('school/documents')
export class SchoolDocumentsController {
  constructor(private readonly service: SchoolDocumentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.readDocuments)
  list(
    @CurrentUser() user: AuthUser,
    @Query('ownerType') ownerType?: string,
    @Query('ownerId') ownerId?: string,
    @Query('category') category?: string,
    @Query('type') type?: string,
    @Query('verified') verified?: string,
    @Query('expiry') expiry?: 'expiring' | 'expired',
    @Query('expiryDays') expiryDays?: string,
  ) {
    return this.service.list({
      ownerType, ownerId, category, type,
      verified: verified === undefined ? undefined : verified === 'true',
      expiry, expiryDays: expiryDays ? Number(expiryDays) : undefined,
      roles: user.permissions,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.readDocuments)
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.get(id, user.permissions);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageDocuments)
  create(@Body() dto: CreateSchoolDocDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageDocuments)
  update(@Param('id') id: string, @Body() dto: UpdateSchoolDocDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/verify')
  @RequirePermissions(PERMISSIONS.school.manageDocuments)
  verify(@Param('id') id: string, @Body() dto: VerifySchoolDocDto) {
    return this.service.verify(id, dto.verified);
  }

  @Post(':id/sign')
  @RequirePermissions(PERMISSIONS.school.manageDocuments)
  sign(@Param('id') id: string, @Body() dto: SignSchoolDocDto) {
    return this.service.sign(id, dto.signatureFileId);
  }

  @Get(':id/versions')
  @RequirePermissions(PERMISSIONS.school.readDocuments)
  versions(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.versions(id, user.permissions);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageDocuments)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
