import { Test, TestingModule } from '@nestjs/testing';
import { BackupController } from '../../src/modules/backup/backup.controller';
import { BackupService } from '../../src/modules/backup/backup.service';
import { SettingsService } from '../../src/kernel/settings/settings.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PERMISSIONS } from '@erp/shared';

describe('BackupController', () => {
  let controller: BackupController;
  let mockBackupService: Partial<BackupService>;

  beforeEach(async () => {
    mockBackupService = {
      getStatus: jest.fn().mockReturnValue({ lastByKind: {}, recent: [], config: {} }),
      getHealthStatus: jest.fn().mockResolvedValue({ 
        status: 'healthy', 
        issues: [], 
        lastFullBackup: undefined,
        lastIncrementalBackup: undefined,
      }),
      listBackups: jest.fn().mockResolvedValue([]),
      getConfig: jest.fn().mockReturnValue({ frequency: 'daily' }),
      updateConfig: jest.fn().mockResolvedValue({ frequency: 'daily' }),
      runFullBackup: jest.fn().mockResolvedValue({ kind: 'full', status: 'success' }),
      runIncrementalBackup: jest.fn().mockResolvedValue({ kind: 'incremental', status: 'success' }),
      runFilesBackup: jest.fn().mockResolvedValue({ kind: 'files', status: 'success' }),
      runConfigBackup: jest.fn().mockResolvedValue({ kind: 'config', status: 'success' }),
      cleanup: jest.fn().mockResolvedValue(undefined),
      restore: jest.fn().mockResolvedValue({ success: true, message: 'Restored' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BackupController],
      providers: [
        { provide: BackupService, useValue: mockBackupService },
      ],
    }).compile();

    controller = module.get<BackupController>(BackupController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('status', () => {
    it('should return backup status', () => {
      const result = controller.status();
      expect(result).toHaveProperty('lastByKind');
      expect(result).toHaveProperty('recent');
      expect(result).toHaveProperty('config');
    });
  });

  describe('health', () => {
    it('should return backup health status', async () => {
      const result = await controller.health();
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('issues');
    });
  });

  describe('list', () => {
    it('should return list of backups', async () => {
      // `kind` is a @Query() string, not an object — the spec drifted from the
      // controller signature and stopped compiling, taking the whole suite with it.
      const result = await controller.list('full');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getSettings', () => {
    it('should return backup config', () => {
      const result = controller.getSettings();
      expect(result).toHaveProperty('frequency');
    });
  });

  describe('runFull', () => {
    it('should trigger full backup', async () => {
      const result = await controller.runFull();
      expect(result.kind).toBe('full');
      expect(result.status).toBe('success');
    });
  });

  describe('restore', () => {
    it('should trigger restore', async () => {
      const result = await controller.restore({ 
        scope: 'database', 
        backupFile: '/path/to/backup.dump' 
      });
      expect(result.success).toBe(true);
    });
  });

  describe('verifyRestore', () => {
    it('should verify backup without restoring', async () => {
      const result = await controller.verifyRestore({ 
        backupFile: '/path/to/backup.dump' 
      });
      expect(result.success).toBe(true);
    });
  });
});