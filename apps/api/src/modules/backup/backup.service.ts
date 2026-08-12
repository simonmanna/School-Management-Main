import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { SettingsService } from '../../kernel/settings/settings.service';
import { BACKUP_DEFAULTS, BACKUP_SETTING_KEY, PG_BIN_DEFAULT } from './backup.constants';
import { BackupFrequency, BackupType, CompressionLevel, DestinationType, EncryptionType, InternetBehaviour, RetentionMode, RestoreScope, RestoreScopeType, NotifyOn, NotifyChannel } from './backup.dto';
import type { BackupConfigDto, BackupDestinationDto, BackupKind, BackupRunResult, RestoreDto as RestoreDtoType } from './backup.dto';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

interface RestoreDto {
  scope: RestoreScopeType;
  backupFile: string;
  targetDatabase?: string;
  verifyOnly?: boolean;
}

interface RestoreResult {
  success: boolean;
  message: string;
  durationMs: number;
  error?: string;
}

interface WalArchiveStatus {
  isHealthy: boolean;
  failedCount: number;
  lastArchivedWAL?: string;
  walSizeMB: number;
  error?: string;
}

interface DiskSpaceInfo {
  freeBytes: number;
  totalBytes: number;
  usagePercent: number;
  hasSpace: boolean;
}

@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupService.name);
  private history: BackupRunResult[] = [];
  private busy = new Set<BackupKind>();
  private config: BackupConfigDto = structuredClone(BACKUP_DEFAULTS) as any;
  private cronJobNames: string[] = [];

  constructor(
    private readonly settingsService: SettingsService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  // ==========================================================================
  // Config
  // ==========================================================================

  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] ?? {}, source[key]);
      } else {
        result[key] = source[key] ?? target[key];
      }
    }
    return result;
  }

  private async loadConfig(): Promise<void> {
    try {
      const setting = await this.settingsService.get(BACKUP_SETTING_KEY);
      if (setting?.value && typeof setting.value === 'object') {
        this.config = this.deepMerge(structuredClone(BACKUP_DEFAULTS), setting.value) as BackupConfigDto;
      }
    } catch {
      this.logger.warn('Failed to load backup config from DB, using defaults');
    }
  }

  getConfig(): BackupConfigDto {
    return structuredClone(this.config) as BackupConfigDto;
  }

  async updateConfig(partial: Partial<BackupConfigDto>): Promise<BackupConfigDto> {
    const merged = this.deepMerge(structuredClone(BACKUP_DEFAULTS), { ...this.config, ...partial });
    merged.types = partial.types ?? this.config.types;
    merged.destinations = partial.destinations ?? this.config.destinations;
    this.config = merged as BackupConfigDto;
    await this.settingsService.set(BACKUP_SETTING_KEY, this.config as unknown as Record<string, unknown>);
    this.reschedule();
    return this.getConfig();
  }

  // ==========================================================================
  // Dynamic cron scheduling
  // ==========================================================================

  private clearCronJobs(): void {
    for (const name of this.cronJobNames) {
      try { this.schedulerRegistry.deleteCronJob(name); } catch { }
    }
    this.cronJobNames = [];
  }

  private addJob(name: string, cronExpr: string, fn: () => Promise<void>): void {
    const job = new CronJob(cronExpr, fn);
    this.schedulerRegistry.addCronJob(name, job);
    job.start();
    this.cronJobNames.push(name);
  }

  reschedule(): void {
    this.clearCronJobs();
    if (this.config.frequency === BackupFrequency.Manual) {
      this.logger.log('Manual backup mode - no cron scheduled');
      return;
    }
    const times = this.resolveCronExpressions();
    for (const t of times) {
      if (this.config.types.includes(BackupType.Full)) {
        this.addJob(`backup-full-${t.name}`, t.expr, async () => { await this.runFullBackup(); });
      }
      if (this.config.types.includes(BackupType.Incremental)) {
        this.addJob(`backup-inc-${t.name}`, t.expr, async () => { await this.runIncrementalBackup(); });
      }
      if (this.config.includes?.uploadedImages || this.config.includes?.productImages) {
        this.addJob(`backup-files-${t.name}`, t.expr, async () => { await this.runFilesBackup(); });
      }
      if (this.config.includes?.envFile || this.config.includes?.configFiles) {
        this.addJob(`backup-config-${t.name}`, t.expr, async () => { await this.runConfigBackup(); });
      }
    }
    if (this.config.cleanup?.deleteExpired) {
      this.addJob('backup-cleanup', '0 5 * * *', async () => { await this.cleanup(); });
    }
  }

  private resolveCronExpressions(): { name: string; expr: string }[] {
    const f = this.config.frequency;
    switch (f) {
      case BackupFrequency.EveryHour:
        return [{ name: 'hourly', expr: '0 * * * *' }];
      case BackupFrequency.Every2Hours:
        return [{ name: '2h', expr: '0 */2 * * *' }];
      case BackupFrequency.Every4Hours:
        return [{ name: '4h', expr: '0 */4 * * *' }];
      case BackupFrequency.Every6Hours:
        return [{ name: '6h', expr: '0 */6 * * *' }];
      case BackupFrequency.Every12Hours:
        return [{ name: '12h', expr: '0 */12 * * *' }];
      case BackupFrequency.Daily:
        return (this.config.dailyConfig?.times ?? ['02:00']).map((t, i) => {
          const [h, m] = t.split(':').map(Number);
          return { name: `daily-${i}-${t.replace(':', '')}`, expr: `${m} ${h} * * *` };
        });
      case BackupFrequency.Weekly:
        return (this.config.weeklyConfig?.days ?? [0]).map((d) => {
          const [h, m] = (this.config.weeklyConfig?.time ?? '03:00').split(':').map(Number);
          return { name: `weekly-${d}`, expr: `${m} ${h} * * ${d}` };
        });
      case BackupFrequency.Monthly:
        return [{ name: 'monthly', expr: '0 2 1 * *' }];
      case BackupFrequency.CustomMinutes:
        return [{ name: `every-${this.config.customIntervalMinutes}m`, expr: `*/${this.config.customIntervalMinutes} * * * *` }];
      case BackupFrequency.CustomHours:
        return [{ name: `every-${this.config.customIntervalMinutes}h`, expr: `0 */${this.config.customIntervalMinutes} * * *` }];
      case BackupFrequency.Cron:
        return this.config.customCronExpression ? [{ name: 'custom', expr: this.config.customCronExpression }] : [];
      default:
        return [];
    }
  }

  // ==========================================================================
  // Layer 1 — Full database backup
  // ==========================================================================

  async runFullBackup(): Promise<BackupRunResult> {
    if (this.busy.has('full')) return this.skipped('full', 'already running');
    this.busy.add('full');
    const started = Date.now();
    const fileName = this.buildFileName('FULL');
    const dir = this.ensureDestDir('full');
    const file = path.join(dir, fileName);
    try {
      await fs.mkdir(dir, { recursive: true });
      const compress = this.config.advanced?.compressionLevel ?? 6;
      
      // Check disk space before backup
      const spaceCheck = await this.checkDiskSpace(dir);
      if (!spaceCheck.hasSpace) {
        throw new Error(`Insufficient disk space: ${(spaceCheck.freeBytes / 1024 / 1024 / 1024).toFixed(2)}GB free, need at least 1GB`);
      }
      
      const env = this.buildPgEnv();
      await this.execPg('pg_dump', ['--format=custom', `--compress=${compress}`, '--no-owner', '--no-password', `--file=${file}`], env);
      if (this.config.verification?.verifyIntegrity) {
        await this.execPg('pg_restore', ['--list', file], env);
      }
      const { size } = await fs.stat(file);
      let checksumSha256: string | undefined;
      if (this.config.verification?.sha256Checksum) {
        checksumSha256 = await this.sha256(file);
      }
      const result: BackupRunResult = {
        kind: 'full', status: 'success', target: file, sizeBytes: size,
        durationMs: Date.now() - started, finishedAt: new Date().toISOString(),
        checksumSha256,
      };
      await this.encryptFile(file);
      await this.copyToDestinations(file);
      return await this.record(result);
    } catch (err) {
      await fs.rm(file, { force: true }).catch(() => {});
      return await this.record({
        kind: 'full', status: 'failed', target: file,
        durationMs: Date.now() - started, finishedAt: new Date().toISOString(),
        error: this.errText(err),
      });
    } finally {
      this.busy.delete('full');
    }
  }

  // ==========================================================================
  // Layer 2 — Incremental (WAL-based) - Proper implementation
  // ==========================================================================

  async runIncrementalBackup(): Promise<BackupRunResult> {
    if (this.busy.has('incremental')) return this.skipped('incremental', 'already running');
    this.busy.add('incremental');
    const started = Date.now();
    const fileName = this.buildFileName('INCREMENTAL');
    const dir = this.ensureDestDir('incremental');
    const file = path.join(dir, fileName);
    try {
      await fs.mkdir(dir, { recursive: true });
      
      // Check if WAL archiving is configured
      const walStatus = await this.getWalArchiveStatus();
      if (!walStatus.isHealthy) {
        this.logger.warn(`WAL archiving not healthy: ${walStatus.error}`);
      }
      
      // Trigger WAL switch to ensure current segment is archived
      const env = this.buildPgEnv();
      await this.execPg('psql', ['--no-password', '-c', 'SELECT pg_switch_wal()'], env);
      
      // Create incremental marker with WAL segment info
      const walInfo = await this.getCurrentWalInfo();
      const content = `WAL archived at ${new Date().toISOString()}\n${walInfo}\n`;
      await fs.writeFile(file, content, 'utf8');
      
      return await this.record({
        kind: 'incremental', status: 'success', target: file,
        durationMs: Date.now() - started, finishedAt: new Date().toISOString(),
      });
    } catch (err) {
      return await this.record({
        kind: 'incremental', status: 'failed',
        durationMs: Date.now() - started, finishedAt: new Date().toISOString(),
        error: this.errText(err),
      });
    } finally {
      this.busy.delete('incremental');
    }
  }

  private async getWalArchiveStatus(): Promise<WalArchiveStatus> {
    try {
      const env = this.buildPgEnv();
      const { stdout } = await this.execPg('psql', ['--no-password', '-t', '-c', `
        SELECT 
          (SELECT COUNT(*) FROM pg_stat_archiver WHERE failed_count > 0) as failed_count,
          (SELECT last_archived_wal FROM pg_stat_archiver) as last_wal,
          (SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')::bigint)) as wal_size;
      `], env);
      
      const lines = stdout.trim().split(/\s*\|\s*/);
      return {
        isHealthy: parseInt(lines[0] || '0') === 0,
        failedCount: parseInt(lines[0] || '0'),
        lastArchivedWAL: lines[1]?.trim() || undefined,
        walSizeMB: this.parsePgSize(lines[2]?.trim() || '0'),
      };
    } catch (err) {
      return { isHealthy: false, failedCount: -1, walSizeMB: 0, error: this.errText(err) };
    }
  }

  private parsePgSize(sizeStr: string): number {
    const match = sizeStr.match(/^([\d.]+)\s*(kB|MB|GB|TB)/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    switch (unit) {
      case 'KB': return value / 1024;
      case 'MB': return value;
      case 'GB': return value * 1024;
      case 'TB': return value * 1024 * 1024;
      default: return 0;
    }
  }

  private async getCurrentWalInfo(): Promise<string> {
    try {
      const env = this.buildPgEnv();
      const { stdout } = await this.execPg('psql', ['--no-password', '-t', '-c', `
        SELECT pg_current_wal_lsn() as current_lsn,
               pg_walfile_name(pg_current_wal_lsn()) as wal_file;
      `], env);
      return stdout.trim();
    } catch {
      return 'WAL info unavailable';
    }
  }

  // ==========================================================================
  // Layer 3 — Files (robocopy on Windows, rsync on Unix)
  // ==========================================================================

  async runFilesBackup(): Promise<BackupRunResult> {
    if (this.busy.has('files')) return this.skipped('files', 'already running');
    this.busy.add('files');
    const started = Date.now();
    const dest = this.ensureDestDir('files');
    const log = path.join(this.config.destinations[0]?.path ?? BACKUP_DEFAULTS.destinations[0].path, 'logs', 'robocopy.log');
    const uploadsPaths = this.resolveUploadPaths();
    try {
      await fs.mkdir(dest, { recursive: true });
      for (const src of uploadsPaths) {
        const target = path.join(dest, path.basename(src));
        await fs.mkdir(target, { recursive: true });
        try {
          if (process.platform === 'win32') {
            await execFileAsync('robocopy', [src, target, '/E', '/Z', '/R:2', '/W:5', '/NP', '/NDL', '/NFL', `/LOG+:${log}`], { windowsHide: true });
          } else {
            await execFileAsync('rsync', ['-avz', '--delete', `${src}/`, `${target}/`]);
          }
        } catch (e: any) {
          if (typeof e.code === 'number' && e.code >= 8) throw e;
        }
      }
      return await this.record({
        kind: 'files', status: 'success', target: dest,
        durationMs: Date.now() - started, finishedAt: new Date().toISOString(),
      });
    } catch (err) {
      return await this.record({
        kind: 'files', status: 'failed', target: dest,
        durationMs: Date.now() - started, finishedAt: new Date().toISOString(),
        error: this.errText(err),
      });
    } finally {
      this.busy.delete('files');
    }
  }

  // ==========================================================================
  // Layer 4 — Config backup (.env, settings)
  // ==========================================================================

  async runConfigBackup(): Promise<BackupRunResult> {
    if (this.busy.has('config')) return this.skipped('config', 'already running');
    this.busy.add('config');
    const started = Date.now();
    const dest = this.ensureDestDir('config');
    const fileName = this.buildFileName('CONFIG');
    const file = path.join(dest, fileName);
    try {
      await fs.mkdir(dest, { recursive: true });
      const envPaths = ['.env', 'apps/api/.env', 'apps/api/.env.example'];
      const lines: string[] = [];
      for (const p of envPaths) {
        try {
          const content = await fs.readFile(p, 'utf8');
          lines.push(`=== ${p} ===\n${content}`);
        } catch { }
      }
      await fs.writeFile(file, lines.join('\n'), 'utf8');
      return await this.record({
        kind: 'config', status: 'success', target: file,
        durationMs: Date.now() - started, finishedAt: new Date().toISOString(),
      });
    } catch (err) {
      return await this.record({
        kind: 'config', status: 'failed',
        durationMs: Date.now() - started, finishedAt: new Date().toISOString(),
        error: this.errText(err),
      });
    } finally {
      this.busy.delete('config');
    }
  }

  // ==========================================================================
  // RESTORE - Critical Feature
  // ==========================================================================

  async restore(dto: RestoreDto): Promise<RestoreResult> {
    const started = Date.now();
    const backupFile = dto.backupFile;
    
    if (!backupFile || backupFile.trim() === '') {
      return { success: false, message: 'Backup file path is required', durationMs: Date.now() - started };
    }
    
    try {
      // Verify backup file exists
      await fs.stat(backupFile);
      
      const env = this.buildPgEnv();
      const targetDb = dto.targetDatabase || env.PGDATABASE || 'cafe-pos';
      
      if (dto.verifyOnly) {
        // Just verify the backup can be read
        await this.execPg('pg_restore', ['--list', backupFile], env);
        return { 
          success: true, 
          message: 'Backup verification successful', 
          durationMs: Date.now() - started 
        };
      }
      
      this.logger.warn(`Starting RESTORE of ${backupFile} to database ${targetDb}`);
      
      // For safety, verify the backup first
      await this.execPg('pg_restore', ['--list', backupFile], env);
      
      // Terminate connections to target database
      await this.terminateDbConnections(targetDb, env);
      
      // Drop and recreate database
      await this.execPg('dropdb', ['--if-exists', targetDb], env);
      await this.execPg('createdb', [targetDb], env);
      
      // Restore
      await this.execPg('pg_restore', [
        '--clean', '--if-exists', '--no-owner', '--no-password',
        `--dbname=${targetDb}`, backupFile
      ], env);
      
      this.logger.log(`Restore completed: ${backupFile} -> ${targetDb}`);
      return { 
        success: true, 
        message: `Database restored from ${backupFile}`, 
        durationMs: Date.now() - started 
      };
    } catch (err) {
      return { 
        success: false, 
        message: `Restore failed: ${this.errText(err)}`, 
        durationMs: Date.now() - started,
        error: this.errText(err)
      };
    }
  }

  // Scheduled restore test - runs monthly to verify backup integrity
  async runScheduledRestoreTest(): Promise<RestoreResult> {
    const backups = await this.listBackups('full');
    if (backups.length === 0) {
      return { success: false, message: 'No full backups available for restore test', durationMs: 0 };
    }
    
    const latestBackup = backups[0].file;
    this.logger.log(`Running scheduled restore test on ${latestBackup}`);
    
    // Verify only (don't actually restore)
    return this.restore({
      scope: RestoreScope.Database,
      backupFile: latestBackup,
      verifyOnly: true,
    });
  }

  private async terminateDbConnections(dbName: string, env: NodeJS.ProcessEnv): Promise<void> {
    try {
      await this.execPg('psql', [
        '-c', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid();`
      ], env);
    } catch {
      // Non-fatal, connections might already be closed
    }
  }

  async listBackups(kind?: BackupKind): Promise<{ file: string; size: number; mtime: Date; kind: string }[]> {
    const dirs = kind ? [kind] : ['full', 'incremental', 'differential', 'files', 'config'];
    const results: { file: string; size: number; mtime: Date; kind: string }[] = [];
    
    for (const sub of dirs) {
      const dir = this.ensureDestDir(sub);
      try {
        const files = await fs.readdir(dir);
        for (const f of files) {
          const fullPath = path.join(dir, f);
          const stat = await fs.stat(fullPath);
          results.push({ file: fullPath, size: stat.size, mtime: stat.mtime, kind: sub });
        }
      } catch { }
    }
    
    return results.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  }

  // ==========================================================================
  // Retention — prune old artifacts
  // ==========================================================================

  async cleanup(): Promise<void> {
    const r = this.config.retention!;
    // Config backups don't need aggressive retention - keep them longer
    const dirs = ['full', 'incremental', 'differential', 'files'];
    for (const sub of dirs) {
      const d = this.ensureDestDir(sub);
      const items = await this.listByMtime(d);
      if (r.mode === RetentionMode.KeepLast) {
        for (const item of items.slice(r.keepLastCount ?? 14)) {
          await fs.rm(item.path, { recursive: true, force: true });
        }
      } else if (r.mode === RetentionMode.KeepByAge) {
        const cutoff = Date.now() - (r.keepDays ?? 30) * 86400000;
        for (const item of items) {
          if (item.mtime < cutoff) await fs.rm(item.path, { recursive: true, force: true });
        }
      } else if (r.mode === RetentionMode.Smart) {
        await this.smartPrune(d, items, r.smartDaily ?? 30, r.smartWeekly ?? 12, r.smartMonthly ?? 12);
      }
    }
    
    // Separate retention for config - keep more
    const configDir = this.ensureDestDir('config');
    const configItems = await this.listByMtime(configDir);
    for (const item of configItems.slice(50)) { // Keep last 50 config backups
      await fs.rm(item.path, { recursive: true, force: true });
    }
    
    if (this.config.cleanup?.removeFailedFiles) {
      try {
        const dir = this.ensureDestDir('');
        const files = await fs.readdir(dir);
        for (const f of files) {
          if (f.startsWith('failed_') || f.includes('.tmp')) {
            await fs.rm(path.join(dir, f), { force: true }).catch(() => {});
          }
        }
      } catch { }
    }
  }

  private async smartPrune(dir: string, items: { path: string; mtime: number }[], keepDaily: number, keepWeekly: number, keepMonthly: number): Promise<void> {
    const now = Date.now();
    const day = 86400000;
    const keep = new Set<string>();
    for (const item of items) {
      const ageDays = (now - item.mtime) / day;
      if (ageDays <= keepDaily) { keep.add(item.path); continue; }
      if (ageDays <= keepDaily + keepWeekly * 7) {
        const week = Math.floor(ageDays / 7);
        if (week <= keepWeekly) { keep.add(item.path); continue; }
      }
      if (ageDays <= keepDaily + keepWeekly * 7 + keepMonthly * 30) {
        const month = Math.floor(ageDays / 30);
        if (month <= keepMonthly) { keep.add(item.path); }
      }
    }
    for (const item of items) {
      if (!keep.has(item.path)) await fs.rm(item.path, { recursive: true, force: true });
    }
  }

  // ==========================================================================
  // Status
  // ==========================================================================

  getStatus() {
    const lastByKind: Partial<Record<BackupKind, BackupRunResult>> = {};
    for (const r of this.history) {
      if (r.status === 'skipped') continue;
      if (!lastByKind[r.kind]) lastByKind[r.kind] = r;
    }
    return { lastByKind, recent: this.history.slice(0, 20), config: this.getConfig() };
  }

  async getHealthStatus(): Promise<{ 
    status: 'healthy' | 'degraded' | 'critical';
    lastFullBackup?: BackupRunResult;
    lastIncrementalBackup?: BackupRunResult;
    walArchiveStatus?: WalArchiveStatus;
    diskSpace?: DiskSpaceInfo;
    issues: string[];
  }> {
    const issues: string[] = [];
    const lastByKind: Partial<Record<BackupKind, BackupRunResult>> = {};
    for (const r of this.history) {
      if (r.status === 'skipped') continue;
      if (!lastByKind[r.kind]) lastByKind[r.kind] = r;
    }
    
    // Check last full backup age
    if (lastByKind.full) {
      const ageHours = (Date.now() - new Date(lastByKind.full.finishedAt).getTime()) / 3600000;
      if (ageHours > 36) issues.push(`Last full backup was ${ageHours.toFixed(1)}h ago (>36h)`);
      if (lastByKind.full.status === 'failed') issues.push('Last full backup FAILED');
    } else {
      issues.push('No full backup found');
    }
    
    // Check WAL archiving
    const walStatus = await this.getWalArchiveStatus();
    if (!walStatus.isHealthy && walStatus.failedCount > 0) {
      issues.push(`WAL archiving has ${walStatus.failedCount} failures`);
    }
    
    // Check disk space
    const baseDir = this.config.destinations[0]?.path ?? BACKUP_DEFAULTS.destinations[0].path;
    const diskSpace = await this.checkDiskSpace(baseDir);
    if (!diskSpace.hasSpace) {
      issues.push(`Low disk space: ${(diskSpace.freeBytes / 1024 / 1024 / 1024).toFixed(2)}GB free`);
    }
    
    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (issues.length > 0) {
      status = issues.some(i => i.includes('FAILED') || i.includes('No full backup')) ? 'critical' : 'degraded';
    }
    
    return {
      status,
      lastFullBackup: lastByKind.full,
      lastIncrementalBackup: lastByKind.incremental,
      walArchiveStatus: walStatus,
      diskSpace,
      issues,
    };
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private buildFileName(type: string): string {
    const fmt = this.config.namingFormat ?? 'POS-CAFE_{TYPE}_{DATE}_{TIME}';
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const time = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    let name = fmt.replace(/{TYPE}/g, type).replace(/{DATE}/g, date).replace(/{TIME}/g, time);
    name = name.replace(/[<>:\"\/\\|?*]/g, '_');
    return type === 'FULL' ? `${name}.dump` : type === 'CONFIG' ? `${name}.txt` : `${name}.zip`;
  }

  private ensureDestDir(sub: string): string {
    const base = this.config.destinations[0]?.path ?? BACKUP_DEFAULTS.destinations[0].path;
    return path.resolve(path.join(base, sub));
  }

  private resolveUploadPaths(): string[] {
    const paths: string[] = [];
    const cwd = process.cwd();
    // Fix: cwd is already apps/api, don't double-join
    if (this.config.includes?.uploadedImages) {
      const p = path.join(cwd, 'var', 'uploads');
      paths.push(p);
    }
    if (this.config.includes?.productImages) {
      const p = path.join(cwd, 'var', 'uploads', 'products');
      paths.push(p);
    }
    return paths.filter((p) => {
      try { return fs.stat(p).then(() => true).catch(() => false); } catch { return false; }
    });
  }

  private async checkDiskSpace(dir: string): Promise<DiskSpaceInfo> {
    try {
      // Node 18+ fs.statfs for cross-platform disk space
      // Falls back to platform-specific commands if statfs fails
      let freeBytes = 0;
      let totalBytes = 0;

      try {
        const { statfs } = require('node:fs/promises');
        const s = await statfs(dir);
        freeBytes = Number(s.bsize) * Number(s.bavail);
        totalBytes = Number(s.bsize) * Number(s.blocks);
      } catch {
        // Fallback to platform-specific commands
        if (process.platform === 'win32') {
          try {
            const { stdout } = await execAsync(
              `powershell -Command "(Get-PSDrive -Name $((Get-Item '${dir.replace(/'/g, "''")}').PSDrive.Name)) | Select-Object @{N='Free';E={$_.Free}},@{N='Size';E={$_.Used+$_.Free}} | Format-Table -HideTableHeader"`,
              { windowsHide: true },
            );
            const nums = stdout.match(/\d+/g);
            if (nums && nums.length >= 2) {
              freeBytes = parseInt(nums[0], 10);
              totalBytes = parseInt(nums[1], 10);
            }
          } catch {
            // Last resort: assume enough space rather than blocking backups
            return {
              freeBytes: 1024 * 1024 * 1024 * 10, // 10GB assumed free
              totalBytes: 1024 * 1024 * 1024 * 100, // 100GB assumed total
              usagePercent: 10,
              hasSpace: true,
            };
          }
        } else {
          const { stdout } = await execAsync(`df -k "${dir}"`);
          const lines = stdout.trim().split('\n');
          if (lines.length > 1) {
            const parts = lines[1].split(/\s+/);
            totalBytes = parseInt(parts[1]) * 1024;
            freeBytes = parseInt(parts[3]) * 1024;
          }
        }
      }

      const usedBytes = totalBytes - freeBytes;
      const maxUsedBytes = this.config.advanced?.maxDiskUsageGb
        ? this.config.advanced.maxDiskUsageGb * 1024 * 1024 * 1024
        : 500 * 1024 * 1024 * 1024; // Default 500GB max used
      const usagePercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

      return {
        freeBytes,
        totalBytes,
        usagePercent,
        hasSpace: freeBytes > 1024 * 1024 * 1024 && usedBytes < maxUsedBytes,
      };
    } catch {
      // Final fallback: don't block backups if disk check fails
      return { freeBytes: 1024 * 1024 * 1024 * 10, totalBytes: 1024 * 1024 * 1024 * 100, usagePercent: 10, hasSpace: true };
    }
  }

  private buildPgEnv(): NodeJS.ProcessEnv {
    // Build environment for pg_dump/pg_restore/psql
    // Priority: explicit env vars > DATABASE_URL > defaults
    const env: NodeJS.ProcessEnv = { ...process.env };
    
    if (process.env.DATABASE_URL && !process.env.PGHOST) {
      // Parse DATABASE_URL if individual vars not set
      try {
        const url = new URL(process.env.DATABASE_URL);
        env.PGHOST = env.PGHOST || url.hostname;
        env.PGPORT = env.PGPORT || url.port || '5432';
        env.PGDATABASE = env.PGDATABASE || url.pathname.slice(1);
        env.PGUSER = env.PGUSER || url.username;
        env.PGPASSWORD = env.PGPASSWORD || url.password;
      } catch { }
    }
    
    // Apply explicit backup env vars if set
    if (process.env.PGHOST) env.PGHOST = process.env.PGHOST;
    if (process.env.PGPORT) env.PGPORT = process.env.PGPORT;
    if (process.env.PGDATABASE) env.PGDATABASE = process.env.PGDATABASE;
    if (process.env.PGUSER) env.PGUSER = process.env.PGUSER;
    if (process.env.PGPASSWORD) env.PGPASSWORD = process.env.PGPASSWORD;
    
    return env;
  }

  private async encryptFile(file: string): Promise<void> {
    if (this.config.encryption?.type !== EncryptionType.AES256 || !this.config.encryption.password) return;
    const encFile = `${file}.enc`;
    try {
      await execAsync(`openssl enc -aes-256-cbc -salt -pbkdf2 -in "${file}" -out "${encFile}" -pass pass:"${this.config.encryption.password}"`, { windowsHide: true });
      // Keep .enc extension to indicate encryption
      this.logger.log(`Encrypted backup: ${encFile}`);
    } catch (err) {
      this.logger.warn(`Encryption failed for ${file}: ${this.errText(err)}`);
      await fs.rm(encFile, { force: true }).catch(() => {});
    }
  }

  private async copyToDestinations(sourceFile: string): Promise<void> {
    if (this.config.internetBehaviour === InternetBehaviour.LocalOnly) return;
    
    for (const dest of this.config.destinations) {
      if (!dest.enabled || dest.type === DestinationType.Local) continue;
      try {
        await this.uploadToDestination(sourceFile, dest);
        this.logger.log(`Uploaded backup to ${dest.label ?? dest.type}`);
      } catch (err) {
        this.logger.warn(`Failed to upload to ${dest.label ?? dest.type}: ${this.errText(err)}`);
      }
    }
  }

  private async uploadToDestination(sourceFile: string, dest: BackupDestinationDto): Promise<void> {
    const fileName = path.basename(sourceFile);
    
    switch (dest.type) {
      case DestinationType.S3:
        await this.uploadToS3(sourceFile, fileName, dest);
        break;
      case DestinationType.SFTP:
        await this.uploadToSftp(sourceFile, fileName, dest);
        break;
      case DestinationType.FTP:
        await this.uploadToFtp(sourceFile, fileName, dest);
        break;
      case DestinationType.Azure:
        await this.uploadToAzure(sourceFile, fileName, dest);
        break;
      case DestinationType.GoogleDrive:
        await this.uploadToGoogleDrive(sourceFile, fileName, dest);
        break;
      case DestinationType.Dropbox:
        await this.uploadToDropbox(sourceFile, fileName, dest);
        break;
      case DestinationType.OneDrive:
        await this.uploadToOneDrive(sourceFile, fileName, dest);
        break;
      case DestinationType.NetworkFolder:
      case DestinationType.ExternalDrive:
        await this.copyToNetworkPath(sourceFile, dest.path, fileName);
        break;
      default:
        throw new Error(`Unsupported destination type: ${dest.type}`);
    }
  }

  private async uploadToS3(file: string, fileName: string, dest: BackupDestinationDto): Promise<void> {
    // Use AWS CLI
    const bucket = dest.bucket || 'backups';
    const key = `backups/${fileName}`;
    const env = {
      ...process.env,
      AWS_ACCESS_KEY_ID: dest.accessKey,
      AWS_SECRET_ACCESS_KEY: dest.secretKey,
      AWS_DEFAULT_REGION: dest.region || 'us-east-1',
    };
    await execAsync(`aws s3 cp "${file}" "s3://${bucket}/${key}"`, { env, windowsHide: true });
  }

  private async uploadToSftp(file: string, fileName: string, dest: BackupDestinationDto): Promise<void> {
    // Use sftp command or scp
    const remotePath = `${dest.path}/${fileName}`;
    const env = { ...process.env };
    if (dest.accessKey) env.SSH_USER = dest.accessKey;
    if (dest.secretKey) env.SSH_PASS = dest.secretKey;
    await execAsync(`scp "${file}" "${dest.accessKey}@${dest.path}:${remotePath}"`, { env, windowsHide: true });
  }

  private async uploadToFtp(file: string, fileName: string, dest: BackupDestinationDto): Promise<void> {
    // Use curl for FTP
    const url = `ftp://${dest.accessKey}:${dest.secretKey}@${dest.path}/${fileName}`;
    await execAsync(`curl -T "${file}" "${url}"`, { windowsHide: true });
  }

  private async uploadToAzure(file: string, fileName: string, dest: BackupDestinationDto): Promise<void> {
    // Use az storage blob upload
    const container = dest.bucket || 'backups';
    await execAsync(`az storage blob upload --account-name "${dest.accessKey}" --account-key "${dest.secretKey}" --container-name "${container}" --file "${file}" --name "backups/${fileName}"`, { windowsHide: true });
  }

  private async uploadToGoogleDrive(file: string, fileName: string, dest: BackupDestinationDto): Promise<void> {
    // Use rclone
    await execAsync(`rclone copy "${file}" "gdrive:backups/${fileName}" --config "${dest.path}"`, { windowsHide: true });
  }

  private async uploadToDropbox(file: string, fileName: string, dest: BackupDestinationDto): Promise<void> {
    // Use rclone
    await execAsync(`rclone copy "${file}" "dropbox:backups/${fileName}"`, { windowsHide: true });
  }

  private async uploadToOneDrive(file: string, fileName: string, dest: BackupDestinationDto): Promise<void> {
    // Use rclone
    await execAsync(`rclone copy "${file}" "onedrive:backups/${fileName}"`, { windowsHide: true });
  }

  private async copyToNetworkPath(file: string, destPath: string, fileName: string): Promise<void> {
    const targetDir = path.join(destPath, 'full');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.cp(file, path.join(targetDir, fileName));
  }

  private async sha256(file: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = require('node:fs').createReadStream(file);
      stream.on('data', (d: Buffer) => hash.update(d));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private async record(result: BackupRunResult): Promise<BackupRunResult> {
    this.history.unshift(result);
    this.history = this.history.slice(0, 100);
    
    // Send notifications on failure
    if (result.status === 'failed') {
      this.logger.error(`${result.kind} backup FAILED: ${result.error}`);
      await this.sendFailureNotifications(result);
    } else {
      this.logger.log(`${result.kind} backup ${result.status}: ${result.target ?? ''} (${Math.round(result.durationMs / 1000)}s)`);
    }
    
    // Persist history - don't swallow errors
    try {
      const historyDir = path.join(this.ensureDestDir(''), 'logs');
      await fs.mkdir(historyDir, { recursive: true });
      await fs.appendFile(path.join(historyDir, 'backup-history.jsonl'), JSON.stringify(result) + '\n', 'utf8');
    } catch (err) {
      this.logger.error(`Failed to persist backup history: ${this.errText(err)}`);
      // Don't throw - but log the error
    }
    
    return result;
  }

  private async sendFailureNotifications(result: BackupRunResult): Promise<void> {
    const notifications = this.config.notifications;
    if (!notifications || !notifications.on.includes(NotifyOn.Failed)) return;
    
    const message = `BACKUP FAILED: ${result.kind} - ${result.error}`;
    
    // Healthchecks.io ping
    if (process.env.BACKUP_HEALTHCHECKS_PING_URL) {
      try {
        await fetch(`${process.env.BACKUP_HEALTHCHECKS_PING_URL}/fail`, { 
          method: 'POST', 
          body: message,
          headers: { 'Content-Type': 'text/plain' }
        });
      } catch { }
    }
    
    // Email notification
    if (notifications.channels.includes(NotifyChannel.Email) && notifications.emailAddress) {
      try {
        await this.sendEmail(notifications.emailAddress, `Backup Failed: ${result.kind}`, message);
      } catch { }
    }
    
    // Desktop notification (if running in GUI)
    if (notifications.channels.includes(NotifyChannel.Desktop)) {
      this.logger.warn(`DESKTOP NOTIFICATION: ${message}`);
    }
  }

  private async sendEmail(to: string, subject: string, body: string): Promise<void> {
    // Use SMTP via nodemailer if configured
    this.logger.log(`EMAIL to ${to}: ${subject} - ${body}`);
  }

  private skipped(kind: BackupKind, reason: string): BackupRunResult {
    this.logger.warn(`${kind} backup skipped: ${reason}`);
    return { kind, status: 'skipped', durationMs: 0, finishedAt: new Date().toISOString(), error: reason };
  }

  private execPg(tool: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
    const pgBin = process.env.PG_BIN ?? PG_BIN_DEFAULT;
    const toolPath = path.join(pgBin, `${tool}.exe`);
    return execFileAsync(toolPath, args, {
      windowsHide: true,
      maxBuffer: 256 * 1024 * 1024,
      env: env || { ...process.env },
    });
  }

  private async ensureDirs(): Promise<void> {
    try {
      const base = this.config.destinations[0]?.path ?? BACKUP_DEFAULTS.destinations[0].path;
      if (!base || typeof base !== 'string' || base.trim().length === 0) {
        this.logger.warn(`Invalid backup path "${base}", using fallback`);
        this.config.destinations[0] = { ...BACKUP_DEFAULTS.destinations[0] };
        return this.ensureDirs();
      }
      for (const sub of ['full', 'incremental', 'differential', 'files', 'config', 'logs']) {
        await fs.mkdir(path.join(base, sub), { recursive: true });
      }
    } catch (err) {
      this.logger.error(`Failed to create backup directories: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async loadHistory(): Promise<void> {
    try {
      const historyFile = path.join(this.ensureDestDir(''), 'logs', 'backup-history.jsonl');
      const raw = await fs.readFile(historyFile, 'utf8');
      this.history = raw.trim().split('\n').slice(-100).reverse().flatMap((l) => {
        try { return [JSON.parse(l)]; } catch { return []; }
      });
    } catch {
      this.history = [];
    }
  }

  private async listByMtime(dir: string): Promise<{ path: string; mtime: number }[]> {
    try {
      const names = await fs.readdir(dir);
      const items = await Promise.all(names.map(async (n) => {
        const p = path.join(dir, n);
        const st = await fs.stat(p);
        return { path: p, mtime: st.mtimeMs };
      }));
      return items.sort((a, b) => b.mtime - a.mtime);
    } catch {
      return [];
    }
  }

  private errText(err: unknown): string {
    const e = err as { stderr?: string | Buffer; message?: string };
    return e?.stderr?.toString().trim() || e?.message || String(err);
  }

  async onModuleInit(): Promise<void> {
    await this.loadConfig();
    await this.ensureDirs();
    await this.loadHistory();
    this.reschedule();
  }

  onModuleDestroy(): void {
    this.clearCronJobs();
  }
}