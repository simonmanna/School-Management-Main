/**
 * Wave 14 — audit 2026-09-27 F12 (D12, invariant I-051), against a real server.
 *
 * The scheduled "restore test" used to run `pg_restore --list`, which proves a
 * file is readable and nothing else. The drill restores the newest full backup
 * into a scratch database, checks the key tables against the manifest taken at
 * backup time and that the ledger balances, then drops the scratch database.
 * A damaged backup must FAIL the drill and be recorded as a failure.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describeDb } from './_setup';
import { BackupService } from '../../src/modules/backup/backup.service';

describeDb('integration: wave 14 restore drill (F12)', () => {
  let dir = '';
  let service: BackupService;
  const history: any[] = [];

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'w14-backup-'));
    process.env.BACKUP_DIR = dir;
    // Operator config is a host file (audit 2026-09-29 A03), not a tenant setting.
    await fs.writeFile(path.join(dir, 'backup-config.json'), JSON.stringify({ destinations: [{ type: 'local', path: dir, label: 'Local', enabled: true }] }));
    const scheduler = { addCronJob: () => undefined, deleteCronJob: () => undefined } as any;
    service = new BackupService(scheduler);
    await (service as any).loadConfig();
    const record = (service as any).record.bind(service);
    (service as any).record = async (r: any) => { history.push(r); return record(r); };
  }, 60_000);

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('a full backup writes a manifest, and the drill restores and verifies it', async () => {
    const backup = await service.runFullBackup();
    expect(backup.status).toBe('success');
    const manifest = JSON.parse(await fs.readFile(`${backup.target}.manifest.json`, 'utf8'));
    expect(manifest.counts.Organization).toBeGreaterThan(0);

    const drill = await service.runScheduledRestoreTest();
    expect(drill.message).toMatch(/Restore drill passed/);
    expect(drill.success).toBe(true);
    expect(history.some((h) => h.kind === 'restore-drill' && h.status === 'success')).toBe(true);
  }, 600_000);

  it('a damaged backup fails the drill and is recorded as a failure', async () => {
    const [latest] = (await service.listBackups('full')).filter((b) => b.file.endsWith('.dump'));
    const bytes = await fs.readFile(latest.file);
    const damaged = latest.file.replace(/\.dump$/, '-z.dump');
    await fs.writeFile(damaged, bytes.subarray(0, Math.floor(bytes.length / 3)));
    await fs.copyFile(`${latest.file}.manifest.json`, `${damaged}.manifest.json`);
    const later = new Date(Date.now() + 60_000);
    await fs.utimes(damaged, later, later);

    const drill = await service.runScheduledRestoreTest();
    expect(drill.success).toBe(false);
    expect(drill.message).toMatch(/FAILED/);
    expect(history.some((h) => h.kind === 'restore-drill' && h.status === 'failed')).toBe(true);
  }, 600_000);

  it('refuses to restore over the live database without the operator switch', async () => {
    const [latest] = (await service.listBackups('full')).filter((b) => b.file.endsWith('.dump') && !b.file.endsWith('-z.dump'));
    const res = await service.restore({ scope: 'database' as any, backupFile: latest.file });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/Refusing to restore over the live database/);
  });
});
