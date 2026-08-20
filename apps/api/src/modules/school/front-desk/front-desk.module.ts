import { Module } from '@nestjs/common';
import { FrontDeskService } from './front-desk.service';
import { FrontDeskController } from './front-desk.controller';

@Module({
  controllers: [FrontDeskController],
  providers: [FrontDeskService],
  exports: [FrontDeskService],
})
export class FrontDeskModule {}
