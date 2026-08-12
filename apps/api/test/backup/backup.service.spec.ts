import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { BackupService } from '../../src/modules/backup/backup.service';
import { SettingsService } from '../../src/kernel/settings/settings.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BackupFrequency, BackupType, DestinationType, EncryptionType, InternetBehaviour, RetentionMode, RestoreScope } from '../../src/modules/backup/backup.dto';
import { BACKUP_DEFAULTS } from '../../src/modules/backup/backup.constants';

describe('BackupService', () => {
  let service: BackupService;
  let mockSettingsService: Partial<SettingsService>;
  let mockSchedulerRegistry: Partial<SchedulerRegistry>;
  let backupDir: string;

  beforeEach(async () => {
    mockSettingsService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue({}),
    };

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
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: SchedulerRegistry, useValue: mockSchedulerRegistry },
      ],
    }).compile();

    service = module.get<BackupService>(BackupService);

    // Point the service at an empty scratch directory. It otherwise resolves to
    // `apps/api/backup`, the developer's real backup folder — so "no backups
    // exist" asserted against whatever dumps happened to be on that machine and
    // failed for anyone who had ever run a backup.
    backupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pos-backup-spec-'));
    (service as any).config = {
      ...(service as any).config,
      destinations: [
        { ...(service as any).config.destinations[0], path: backupDir },
      ],
    };
  });

  afterEach(async () => {
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

    it('should persist to settings service', async () => {
      await service.updateConfig({ frequency: BackupFrequency.Manual });
      expect(mockSettingsService.set).toHaveBeenCalled();
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