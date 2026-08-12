import { Global, Module } from '@nestjs/common';
import { ThreeWayMatchService } from './three-way-match.service';
import { ThreeWayMatchController } from './three-way-match.controller';

@Global()
@Module({
  controllers: [ThreeWayMatchController],
  providers: [ThreeWayMatchService],
  exports: [ThreeWayMatchService],
})
export class ThreeWayMatchModule {}
