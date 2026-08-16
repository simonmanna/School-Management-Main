import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { CurrentUser, type AuthUser } from '../../../kernel/auth/decorators/current-user.decorator';
import { SchoolDocumentsService } from './school-documents.service';

@Controller('school/documents')
export class SchoolDocumentsController {
  constructor(private readonly service: SchoolDocumentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
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
  @RequirePermissions(PERMISSIONS.school.read)
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.get(id, user.permissions);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageDocuments)
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageDocuments)
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto);
  }

  @Post(':id/verify')
  @RequirePermissions(PERMISSIONS.school.manageDocuments)
  verify(@Param('id') id: string, @Body('verified') verified: boolean) {
    return this.service.verify(id, verified);
  }

  @Post(':id/sign')
  @RequirePermissions(PERMISSIONS.school.manageDocuments)
  sign(@Param('id') id: string, @Body('signatureFileId') signatureFileId: string) {
    if (!signatureFileId) throw new Error('signatureFileId required');
    return this.service.sign(id, signatureFileId);
  }

  @Get(':id/versions')
  @RequirePermissions(PERMISSIONS.school.read)
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
