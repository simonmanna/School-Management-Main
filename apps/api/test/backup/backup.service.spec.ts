import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { BackupService } from '../../src/modules/backup/backup.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BackupFrequency, BackupType, DestinationType, EncryptionType, InternetBehaviour, RetentionMode, RestoreScope } from '../../src/modules/backup/backup.dto';
import { BACKUP_DEFAULTS } from '../../src/modules/backup/backup.constants';

// Each test compiles a Nest module in beforeEach; under the full parallel unit
// run that alone could pass the 5 s default and fail an otherwise green suite.
jest.setTimeout(30_000);

describe('BackupService', () => {
  let service: BackupService;
  let mockSchedulerRegistry: Partial<SchedulerRegistry>;
  let backupDir: string;

  beforeEach(async () => {
    backupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pos-backup-spec-'));
    process.env.BACKUP_CONFIG_PATH = path.join(backupDir, 'backup-config.json');
    mockSchedulerRegistry = {
      addCronJob: jest.fn(),
      deleteCronJob: jest.fn(),
      doesExist: jest.fn().mockReturnValue(false),
      getCronJob: jest.fn(),
      getCronJobs: jest.fn().mockReturnValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
      ],
    }).compile();

    service = module.get<BackupService>(BackupService);

    // Point the service at an empty scratch directory. It otherwise resolves to
    // `apps/api/backup`, the developer's real backup folder — so "no backups
    // exist" asserted against whatever dumps happened to be on that machine and
    // failed for anyone who had ever run a backup.
    (service as any).config = {
      ...(service as any).config,
      destinations: [
        { ...(service as any).config.destinations[0], path: backupDir },
      ],
    };
  });

  afterEach(async () => {
    // Stop any cron job updateConfig() scheduled, or it holds the process open (A08).
    service?.onModuleDestroy();
    delete process.env.BACKUP_CONFIG_PATH;
    if (backupDir) await fs.rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getConfig', () => {
    it('should return default config when no DB setting exists', () => {
      const config = service.getConfig();
      expect(config.frequency).toBe(BackupFrequency.Daily);
      expect(config.types).toContain(BackupType.Full);
      expect(config.destinations[0].type).toBe(DestinationType.Local);
    });
  });

  describe('updateConfig', () => {
    it('should merge partial config with defaults', async () => {
      const newConfig = await service.updateConfig({
        frequency: BackupFrequency.Weekly,
        dailyConfig: { times: ['03:00'] },
      });
      
      expect(newConfig.frequency).toBe(BackupFrequency.Weekly);
      expect(newConfig.dailyConfig?.times).toEqual(['03:00']);
      expect(newConfig.types).toContain(BackupType.Full); // should preserve default
    });

    // Audit 2026-09-29 A03: host file, never a tenant setting.
    it('persists to the operator config file on the host', async () => {
      await service.updateConfig({ frequency: BackupFrequency.Manual });
      const saved = JSON.parse(await fs.readFile(process.env.BACKUP_CONFIG_PATH!, 'utf8'));
      expect(saved.frequency).toBe(BackupFrequency.Manual);
    });

    it('never echoes stored secrets, and a redacted placeholder keeps them', async () => {
      await service.updateConfig({
        destinations: [
          { type: DestinationType.Local, path: backupDir, label: 'Local', enabled: true },
          { type: DestinationType.S3, path: 'x', label: 'Offsite', enabled: true, bucket: 'b', accessKey: 'AKIA-FICTIONAL', secretKey: 'FICTIONAL-SECRET' },
        ],
        encryption: { type: EncryptionType.AES256, password: 'FICTIONAL-PASS' },
      } as any);
      const shown = service.getConfig();
      expect(JSON.stringify(shown)).not.toMatch(/FICTIONAL/);
      expect(JSON.stringify(service.getStatus())).not.toMatch(/FICTIONAL/);
      expect(shown.destinations[1].secretKey).toBe(BackupService.REDACTED);

      // Round-trip what the operator was shown: secrets must survive unchanged.
      await service.updateConfig({ destinations: shown.destinations, encryption: shown.encryption } as any);
      const saved = JSON.parse(await fs.readFile(process.env.BACKUP_CONFIG_PATH!, 'utf8'));
      expect(saved.destinations[1].secretKey).toBe('FICTIONAL-SECRET');
      expect(saved.encryption.password).toBe('FICTIONAL-PASS');
    });

    it('loads the host file at start-up', async () => {
      await fs.writeFile(process.env.BACKUP_CONFIG_PATH!, JSON.stringify({ frequency: BackupFrequency.Weekly }));
      await (service as any).loadConfig();
      expect(service.getConfig().frequency).toBe(BackupFrequency.Weekly);
    });
  });

  describe('getStatus', () => {
    it('should return empty history initially', () => {
      const status = service.getStatus();
      expect(status.lastByKind).toEqual({});
      expect(status.recent).toEqual([]);
      expect(status.config).toBeDefined();
    });
  });

  describe('restore', () => {
    it('should reject empty backup file path', async () => {
      const result = await service.restore({
        scope: RestoreScope.Database,
        backupFile: '',
      });
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('required');
    });

    it('should reject non-existent backup file', async () => {
      const result = await service.restore({
        scope: RestoreScope.Database,
        backupFile: '/nonexistent/path/dump.dump',
      });
      
      expect(result.success).toBe(false);
    });
  });

  describe('listBackups', () => {
    it('should return empty array when no backups exist', async () => {
      const backups = await service.listBackups('full');
      expect(backups).toEqual([]);
    });
  });

  describe('getHealthStatus', () => {
    it('should return critical when no backups exist', async () => {
      const health = await service.getHealthStatus();
      expect(health.status).toBe('critical');
      expect(health.issues).toContain('No full backup found');
    });
  });

  describe('encryptFile', () => {
    it('should not encrypt when encryption is disabled', async () => {
      // Access private method via any cast for testing
      const testFile = '/tmp/test.dump';
      await (service as any).encryptFile(testFile);
      // Should not throw and should return quickly
    });
  });
});

describe('BackupConfigDto validation', () => {
  it('should have valid defaults', () => {
    expect(BACKUP_DEFAULTS.frequency).toBe(BackupFrequency.Daily);
    expect(BACKUP_DEFAULTS.destinations[0].type).toBe(DestinationType.Local);
    expect(BACKUP_DEFAULTS.encryption.type).toBe(EncryptionType.None);
    expect(BACKUP_DEFAULTS.retention.mode).toBe(RetentionMode.KeepLast);
    expect(BACKUP_DEFAULTS.internetBehaviour).toBe(InternetBehaviour.LocalOnly);
  });
});