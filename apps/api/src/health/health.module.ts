import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { BackupModule } from '../modules/backup/backup.module';

@Module({
  imports: [BackupModule],
  controllers: [HealthController],
})
export class HealthModule {}