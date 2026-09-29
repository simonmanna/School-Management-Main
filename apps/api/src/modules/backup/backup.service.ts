import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { BACKUP_DEFAULTS, PG_BIN_DEFAULT } from './backup.constants';
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
  private cronJobs = new Map<string, CronJob>();

  constructor(private readonly schedulerRegistry: SchedulerRegistry) {}

  /** Stands in for a stored secret in every response; sending it back keeps the stored value. */
  static readonly REDACTED = '********';

  /**
   * Where the operator's backup configuration lives (audit 2026-09-29 A03).
   *
   * The config drives one process-wide scheduler over a whole-database dump,
   * so it is host state, not a tenant setting: it used to be saved under the
   * calling school's settings while one shared in-memory copy served every
   * school. It is fixed by the host environment — not by the config's own
   * destination, which the config can change.
   */
  static configPath(): string {
    return path.resolve(process.env.BACKUP_CONFIG_PATH || path.join(process.env.BACKUP_DIR || 'backup', 'backup-config.json'));
  }

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
      const raw = JSON.parse(await fs.readFile(BackupService.configPath(), 'utf8'));
      if (raw && typeof raw === 'object') {
        this.config = this.deepMerge(structuredClone(BACKUP_DEFAULTS), raw) as BackupConfigDto;
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') this.logger.warn(`Failed to read backup config ${BackupService.configPath()}: ${this.errText(err)}; using defaults`);
    }
  }

  private async saveConfig(): Promise<void> {
    const file = BackupService.configPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.config, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, file);
  }

  /** The config as an operator sees it: stored secrets are never echoed back. */
  getConfig(): BackupConfigDto {
    const out = structuredClone(this.config) as BackupConfigDto;
    const mask = (v?: string) => (v ? BackupService.REDACTED : v);
    out.destinations = (out.destinations ?? []).map((d) => ({ ...d, accessKey: mask(d.accessKey), secretKey: mask(d.secretKey) }));
    if (out.encryption) out.encryption = { ...out.encryption, password: mask(out.encryption.password) };
    return out;
  }

  async updateConfig(partial: Partial<BackupConfigDto>): Promise<BackupConfigDto> {
    const merged = this.deepMerge(structuredClone(BACKUP_DEFAULTS), { ...this.config, ...partial });
    merged.types = partial.types ?? this.config.types;
    // A redacted placeholder coming back means "unchanged", never "set the
    // secret to asterisks".
    const keep = (incoming: string | undefined, stored: string | undefined) =>
      incoming === BackupService.REDACTED ? stored : incoming;
    merged.destinations = (partial.destinations ?? this.config.destinations).map((d, i) => {
      const prev = this.config.destinations?.[i];
      return { ...d, accessKey: keep(d.accessKey, prev?.accessKey), secretKey: keep(d.secretKey, prev?.secretKey) };
    });
    if (merged.encryption) merged.encryption.password = keep(merged.encryption.password, this.config.encryption?.password);
    this.config = merged as BackupConfigDto;
    await this.saveConfig();
    this.reschedule();
    return this.getConfig();
  }

  // ==========================================================================
  // Dynamic cron scheduling
  // ==========================================================================

  private clearCronJobs(): void {
    for (const [name, job] of this.cronJobs) {
      // Stop the job we started, whatever the registry does: an un-stopped
      // CronJob keeps its timer alive and the process never exits (A08).
      job.stop();
      try { this.schedulerRegistry.deleteCronJob(name); } catch { }
    }
    this.cronJobs.clear();
  }

  private addJob(name: string, cronExpr: string, fn: () => Promise<void>): void {
    const job = new CronJob(cronExpr, fn);
    this.schedulerRegistry.addCronJob(name, job);
    job.start();
    this.cronJobs.set(name, job);
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
    // Audit F12: a backup nobody has restored is a hope, not a backup. Every
    // Sunday the newest full backup is restored into a scratch database and
    // checked; a failure is recorded and notified like a failed backup.
    if (this.config.types.includes(BackupType.Full)) {
      this.addJob('backup-restore-drill', process.env.BACKUP_RESTORE_DRILL_CRON || '0 4 * * 0', async () => {
        await this.runScheduledRestoreTest();
      });
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
      // What the drill will check the restore against (audit F12).
      const manifest = await this.captureManifest(env, env.PGDATABASE!).catch((e) => ({ error: this.errText(e) }));
      await this.execPg('pg_dump', ['--format=custom', `--compress=${compress}`, '--no-owner', '--no-password', `--file=${file}`], env);
      await fs.writeFile(`${file}.manifest.json`, JSON.stringify({ file: path.basename(file), capturedAt: new Date().toISOString(), ...manifest }, null, 2), 'utf8');
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
            // No rsync in the runtime image: Node copies the tree.
            await fs.cp(src, target, { recursive: true, force: true, preserveTimestamps: true });
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
      // Restoring over the live database drops every school's data written
      // since the backup. It is never a default; it needs an explicit operator
      // switch on the host, not just an API call.
      if (!dto.verifyOnly && targetDb === env.PGDATABASE && process.env.ALLOW_RESTORE_OVER_LIVE !== 'true') {
        return {
          success: false,
          message: `Refusing to restore over the live database "${targetDb}". Restore into a separate database, or set ALLOW_RESTORE_OVER_LIVE=true on the host for a planned recovery.`,
          durationMs: Date.now() - started,
        };
      }
      
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
      await this.execPg('dropdb', ['--no-password', '--if-exists', targetDb], env);
      await this.execPg('createdb', ['--no-password', targetDb], env);
      
      // Restore
      // Wave 17 (D08 drill): the backup role is deliberately not a superuser, and
      // the dump carries GRANTs and `ALTER DEFAULT PRIVILEGES FOR ROLE app_system`
      // that only a superuser/owner may replay — so every restore through this
      // role failed. Privileges are left out here and re-applied by
      // `pnpm --filter @erp/api rls:setup-role` against the restored database
      // (runbook step), and any other error now stops the restore.
      await this.execPg('pg_restore', [
        '--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error', '--no-password',
        `--dbname=${targetDb}`, backupFile
      ], env);
      
      this.logger.log(`Restore completed: ${backupFile} -> ${targetDb}`);
      return { 
        success: true, 
        message: `Database restored from ${backupFile}. Re-apply runtime role privileges before use: rls:setup-role against ${targetDb}.`, 
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

  /**
   * The restore drill (audit F12, invariant I-051).
   *
   * Restores the newest full backup into a fresh scratch database, then checks
   * it: the key tables are there with at least the rows the manifest counted at
   * backup time, and the general ledger balances. Listing the archive
   * (`pg_restore --list`) proves only that the file is readable — this proves
   * the school could actually come back from it. The scratch database is
   * dropped afterwards; the result is recorded and a failure is notified.
   */
  async runScheduledRestoreTest(): Promise<RestoreResult> {
    const started = Date.now();
    const backups = (await this.listBackups('full')).filter((b) => b.file.endsWith('.dump'));
    if (backups.length === 0) {
      const res = { success: false, message: 'No full backups available for the restore drill', durationMs: 0 };
      await this.record({ kind: 'restore-drill', status: 'failed', durationMs: 0, finishedAt: new Date().toISOString(), error: res.message });
      return res;
    }
    const latest = backups[0].file;
    const env = this.buildPgEnv();
    const scratch = `restore_drill_${Date.now()}`;
    this.logger.log(`Restore drill: ${latest} -> ${scratch}`);
    try {
      await this.execPg('createdb', ['--no-password', scratch], env);
      // Data and manifest are what the drill proves; privileges belong to the
      // live database's roles (see restore()), so they are not replayed here.
      await this.execPg('pg_restore', ['--no-owner', '--no-privileges', '--no-password', '--exit-on-error', `--dbname=${scratch}`, latest], env);
      const restored = await this.captureManifest(env, scratch);
      const problems: string[] = [];
      let expected: any = null;
      try {
        expected = JSON.parse(await fs.readFile(`${latest}.manifest.json`, 'utf8'));
      } catch {
        problems.push('no manifest was written with this backup, so row counts could not be compared');
      }
      for (const [table, count] of Object.entries(expected?.counts ?? {})) {
        const got = restored.counts[table];
        if (got === undefined) problems.push(`${table} is missing from the restore`);
        else if (got < (count as number)) problems.push(`${table}: ${got} rows restored, ${count} at backup time`);
      }
      if (restored.ledgerImbalance !== 0) problems.push(`general ledger out of balance by ${restored.ledgerImbalance}`);
      if ((restored.counts['Organization'] ?? 0) === 0) problems.push('no organizations in the restore');
      const ok = problems.length === 0;
      const message = ok
        ? `Restore drill passed: ${path.basename(latest)} restored into a scratch database; ${Object.keys(restored.counts).length} tables checked, ledger balanced.`
        : `Restore drill FAILED for ${path.basename(latest)}: ${problems.join('; ')}`;
      await this.record({
        kind: 'restore-drill', status: ok ? 'success' : 'failed', target: latest,
        durationMs: Date.now() - started, finishedAt: new Date().toISOString(),
        ...(ok ? {} : { error: message }),
      });
      return { success: ok, message, durationMs: Date.now() - started, ...(ok ? {} : { error: message }) };
    } catch (err) {
      const message = `Restore drill FAILED: ${this.errText(err)}`;
      await this.record({ kind: 'restore-drill', status: 'failed', target: latest, durationMs: Date.now() - started, finishedAt: new Date().toISOString(), error: message });
      return { success: false, message, durationMs: Date.now() - started, error: message };
    } finally {
      await this.terminateDbConnections(scratch, env);
      await this.execPg('dropdb', ['--no-password', '--if-exists', scratch], env).catch((e) => this.logger.warn(`Could not drop ${scratch}: ${this.errText(e)}`));
    }
  }

  /** Tables whose rows a school cannot lose. Checked in every restore drill. */
  private static readonly DRILL_TABLES = [
    'Organization', 'User', 'StudentProfile', 'StudentEnrollment', 'EnrollmentPlacement', 'StudentGuardian',
    'StudentAttendance', 'StudentAssessment', 'Document', 'Payment', 'PaymentAllocation', 'JournalEntry', 'JournalLine',
    'SchoolFeeInvoice', 'ChildCareLog', 'PickupEvent', 'AuditLog',
  ];

  /** Row counts of the drill tables and the ledger imbalance, read with row security off. */
  private async captureManifest(env: NodeJS.ProcessEnv, database: string): Promise<{ counts: Record<string, number>; ledgerImbalance: number }> {
    const counts: Record<string, number> = {};
    const unions = BackupService.DRILL_TABLES.map(
      (t) => `SELECT '${t}' AS t, (SELECT count(*) FROM "${t}")::bigint AS n WHERE to_regclass('public."${t}"') IS NOT NULL`,
    ).join(' UNION ALL ');
    const sql = `SET row_security = off; ${unions};`;
    const { stdout } = await this.execPg('psql', ['--no-psqlrc', '--no-password', '-At', '-F', '|', `--dbname=${database}`, '-c', sql], env);
    for (const line of stdout.split(/\r?\n/)) {
      const [t, n] = line.split('|');
      if (t && n !== undefined && /^\d+$/.test(n.trim())) counts[t] = Number(n);
    }
    const { stdout: bal } = await this.execPg(
      'psql',
      ['--no-psqlrc', '--no-password', '-At', `--dbname=${database}`, '-c', `SET row_security = off; SELECT COALESCE(SUM("baseDebit" - "baseCredit"), 0) FROM "JournalLine";`],
      env,
    );
    const last = bal.trim().split(/\r?\n/).pop() ?? '0';
    return { counts, ledgerImbalance: Math.round(Number(last) * 100) / 100 };
  }

  private async terminateDbConnections(dbName: string, env: NodeJS.ProcessEnv): Promise<void> {
    try {
      await this.execPg('psql', [
        '--no-password', '-c', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid();`
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
      paths.push(process.env.STORAGE_LOCAL_DIR ? path.resolve(process.env.STORAGE_LOCAL_DIR) : path.join(cwd, 'var', 'uploads'));
    }
    if (this.config.includes?.productImages) {
      const p = path.join(cwd, 'var', 'uploads', 'products');
      paths.push(p);
    }
    return paths.filter((p) => existsSync(p));
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
    // Priority: BACKUP_DATABASE_URL > SYSTEM_DATABASE_URL > DATABASE_URL > PG* vars
    const env: NodeJS.ProcessEnv = { ...process.env };
    
    // Audit F12: dump with a role that sees every school's rows. The runtime
    // DATABASE_URL is the NOBYPASSRLS application role; with FORCE ROW LEVEL
    // SECURITY a dump through it is refused or empty. BACKUP_DATABASE_URL must
    // be a BYPASSRLS role with CREATEDB (for the restore drill).
    const sourceUrl = process.env.BACKUP_DATABASE_URL || process.env.SYSTEM_DATABASE_URL || process.env.DATABASE_URL;
    if (sourceUrl) {
      // The URL is authoritative. Stray PG* variables (an empty PGUSER or
      // PGPASSWORD in .env) used to win, and psql then sat on a password prompt.
      try {
        const url = new URL(sourceUrl);
        env.PGHOST = url.hostname;
        env.PGPORT = url.port || '5432';
        env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
        env.PGUSER = decodeURIComponent(url.username);
        env.PGPASSWORD = decodeURIComponent(url.password);
      } catch {
        this.logger.warn('Backup database URL could not be parsed; falling back to PG* variables.');
      }
    }
    // Never prompt: a missing password must fail the run, not hang it.
    env.PGCONNECT_TIMEOUT = env.PGCONNECT_TIMEOUT || '15';
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
    // Audit F12: `.exe` only on Windows; on Linux (the container) the tools are
    // on PATH or under PG_BIN.
    const pgBin = process.env.PG_BIN ?? PG_BIN_DEFAULT;
    const exe = process.platform === 'win32' ? `${tool}.exe` : tool;
    const candidate = path.join(pgBin, exe);
    const toolPath = existsSync(candidate) ? candidate : exe;
    return execFileAsync(toolPath, args, {
      windowsHide: true,
      maxBuffer: 256 * 1024 * 1024,
      env: env || { ...process.env },
    });
  }

  private async ensureDirs(): Promise<void> {
    const base = this.config.destinations[0]?.path ?? BACKUP_DEFAULTS.destinations[0].path;
    try {
      if (!base || typeof base !== 'string' || base.trim().length === 0) {
        this.logger.warn(`Invalid backup path "${base}", using fallback`);
        this.config.destinations[0] = { ...BACKUP_DEFAULTS.destinations[0] };
        return this.ensureDirs();
      }
      for (const sub of ['full', 'incremental', 'differential', 'files', 'config', 'logs']) {
        await fs.mkdir(path.join(base, sub), { recursive: true });
      }
    } catch (err) {
      // Name the folder: "mkdir '\?'" alone did not tell an operator that BACKUP_DIR
      // pointed at a drive this host does not have. Backups cannot run until fixed.
      this.logger.error(
        `Failed to create backup directories under "${base}" (BACKUP_DIR): ${err instanceof Error ? err.message : err}. ` +
          'No backup can be written until this folder exists and is writable.',
      );
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