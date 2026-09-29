import { Test, TestingModule } from '@nestjs/testing';
import { BackupController } from '../../src/modules/backup/backup.controller';
import { BackupService } from '../../src/modules/backup/backup.service';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../src/kernel/auth/decorators/public.decorator';
import { PERMISSIONS_KEY } from '../../src/kernel/auth/decorators/require-permissions.decorator';
import { OperatorSecretGuard } from '../../src/kernel/auth/guards/operator-secret.guard';

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
/**
 * Audit 2026-09-29 A03: School B's Administrator read School A's backup
 * destination because a tenant `backup:*` grant opened a process-wide config.
 * No tenant grant opens these routes now; only the host's operator secret does.
 */
describe('BackupController is operator-only', () => {
  const handlers = Object.getOwnPropertyNames(BackupController.prototype).filter((n) => n !== 'constructor');

  it('is public to the JWT chain and guarded by the operator secret on every route', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, BackupController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, BackupController)).toContain(OperatorSecretGuard);
    for (const h of handlers) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, (BackupController.prototype as any)[h])).toBeUndefined();
    }
  });

  describe('OperatorSecretGuard', () => {
    const ctx = (headers: Record<string, string>) =>
      ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as any;
    const saved = process.env.OPERATOR_SECRET;
    afterEach(() => {
      if (saved === undefined) delete process.env.OPERATOR_SECRET;
      else process.env.OPERATOR_SECRET = saved;
    });

    it('is closed when the host sets no secret', () => {
      delete process.env.OPERATOR_SECRET;
      expect(() => new OperatorSecretGuard().canActivate(ctx({ 'x-operator-secret': 'anything' }))).toThrow(ForbiddenException);
    });

    it('refuses a tenant caller (bearer token, no secret) and a wrong secret', () => {
      process.env.OPERATOR_SECRET = 'fictional-operator-secret';
      expect(() => new OperatorSecretGuard().canActivate(ctx({ authorization: 'Bearer tenant-admin' }))).toThrow(ForbiddenException);
      expect(() => new OperatorSecretGuard().canActivate(ctx({ 'x-operator-secret': 'fictional-operator-secreX' }))).toThrow(ForbiddenException);
    });

    it('admits the operator', () => {
      process.env.OPERATOR_SECRET = 'fictional-operator-secret';
      expect(new OperatorSecretGuard().canActivate(ctx({ 'x-operator-secret': 'fictional-operator-secret' }))).toBe(true);
    });
  });
});
