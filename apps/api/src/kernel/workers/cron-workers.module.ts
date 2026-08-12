import { Global, Module } from '@nestjs/common';
import { CronWorkersService } from './cron-workers.service';

@Global()
@Module({
  providers: [CronWorkersService],
  exports: [CronWorkersService],
})
export class CronWorkersModule {}
