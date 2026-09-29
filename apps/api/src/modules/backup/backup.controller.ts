import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../kernel/auth/decorators/public.decorator';
import { OperatorSecretGuard } from '../../kernel/auth/guards/operator-secret.guard';
import { BackupService } from './backup.service';
import { BackupConfigDto, RestoreDto } from './backup.dto';

/**
 * Whole-database backup and restore — an operator surface (audit 2026-09-29 A03).
 *
 * The dump spans every school and the schedule is process-wide, so a school
 * Administrator's `backup:*` grant used to let one tenant read and rewrite
 * another's backup destination and cron. No JWT role reaches these routes now:
 * `@Public()` skips the tenant auth chain and `OperatorSecretGuard` demands the
 * host's `OPERATOR_SECRET`. See docs/ops/backup-operator.md.
 */
@Public()
@UseGuards(OperatorSecretGuard)
@Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
@Controller('admin/backups')
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Get('status')
  status() {
    return this.backups.getStatus();
  }

  @Get('health')
  async health() {
    return this.backups.getHealthStatus();
  }

  @Get('list')
  async list(@Query('kind') kind?: string) {
    return this.backups.listBackups(kind as any);
  }

  @Get('settings')
  getSettings() {
    return this.backups.getConfig();
  }

  @Put('settings')
  updateSettings(@Body() dto: BackupConfigDto) {
    return this.backups.updateConfig(dto);
  }

  @Post('full')
  runFull() {
    return this.backups.runFullBackup();
  }

  @Post('incremental')
  runIncremental() {
    return this.backups.runIncrementalBackup();
  }

  @Post('files')
  runFiles() {
    return this.backups.runFilesBackup();
  }

  @Post('config')
  runConfig() {
    return this.backups.runConfigBackup();
  }

  @Post('cleanup')
  cleanup() {
    return this.backups.cleanup();
  }

  @Post('restore')
  async restore(@Body() dto: RestoreDto) {
    return this.backups.restore(dto);
  }

  /** Restore the newest full backup into a scratch database and check it (audit F12). */
  @Post('restore/drill')
  async restoreDrill() {
    return this.backups.runScheduledRestoreTest();
  }

  @Post('restore/verify')
  async verifyRestore(@Body() dto: { backupFile: string }) {
    return this.backups.restore({ ...dto, verifyOnly: true, scope: 'database' });
  }
}
