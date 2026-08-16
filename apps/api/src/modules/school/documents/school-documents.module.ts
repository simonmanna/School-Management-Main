import { Module } from '@nestjs/common';
import { SchoolDocumentsService } from './school-documents.service';
import { SchoolDocumentsController } from './school-documents.controller';

@Module({
  controllers: [SchoolDocumentsController],
  providers: [SchoolDocumentsService],
  exports: [SchoolDocumentsService],
})
export class SchoolDocumentsModule {}
