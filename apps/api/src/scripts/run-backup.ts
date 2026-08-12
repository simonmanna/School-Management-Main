import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BackupService } from '../modules/backup/backup.service';

async function main(): Promise<void> {
  const kind = process.argv[2] ?? 'full';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const backups = app.get(BackupService);
    const result =
      kind === 'incremental'
        ? await backups.runIncrementalBackup()
        : kind === 'files'
          ? await backups.runFilesBackup()
          : kind === 'config'
            ? await backups.runConfigBackup()
            : await backups.runFullBackup();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'failed' ? 1 : 0;
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
