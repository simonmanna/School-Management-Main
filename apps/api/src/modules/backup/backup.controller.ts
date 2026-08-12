import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { BackupService } from './backup.service';
import { BackupConfigDto, RestoreDto } from './backup.dto';

@Controller('admin/backups')
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Get('status')
  @RequirePermissions(PERMISSIONS.backup.read)
  status() {
    return this.backups.getStatus();
  }

  @Get('health')
  @RequirePermissions(PERMISSIONS.backup.read)
  async health() {
    return this.backups.getHealthStatus();
  }

  @Get('list')
  @RequirePermissions(PERMISSIONS.backup.read)
  async list(@Query('kind') kind?: string) {
    return this.backups.listBackups(kind as any);
  }

  @Get('settings')
  @RequirePermissions(PERMISSIONS.backup.read)
  getSettings() {
    return this.backups.getConfig();
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.backup.update)
  updateSettings(@Body() dto: BackupConfigDto) {
    return this.backups.updateConfig(dto);
  }

  @Post('full')
  @RequirePermissions(PERMISSIONS.backup.run)
  runFull() {
    return this.backups.runFullBackup();
  }

  @Post('incremental')
  @RequirePermissions(PERMISSIONS.backup.run)
  runIncremental() {
    return this.backups.runIncrementalBackup();
  }

  @Post('files')
  @RequirePermissions(PERMISSIONS.backup.run)
  runFiles() {
    return this.backups.runFilesBackup();
  }

  @Post('config')
  @RequirePermissions(PERMISSIONS.backup.run)
  runConfig() {
    return this.backups.runConfigBackup();
  }

  @Post('cleanup')
  @RequirePermissions(PERMISSIONS.backup.run)
  cleanup() {
    return this.backups.cleanup();
  }

  @Post('restore')
  @RequirePermissions(PERMISSIONS.backup.run)
  async restore(@Body() dto: RestoreDto) {
    return this.backups.restore(dto);
  }

  @Post('restore/verify')
  @RequirePermissions(PERMISSIONS.backup.read)
  async verifyRestore(@Body() dto: { backupFile: string }) {
    return this.backups.restore({ ...dto, verifyOnly: true, scope: 'database' });
  }
}
