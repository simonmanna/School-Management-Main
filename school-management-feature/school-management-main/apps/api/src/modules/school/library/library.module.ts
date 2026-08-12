import { Module } from '@nestjs/common';
import {
  BookCopyService,
  BookMetadataService,
  BorrowingService,
} from '../library/library-transport-hostel-cafeteria.service';
import {
  BookCopyController,
  BookMetadataController,
  BorrowingController,
} from '../library/library-transport-hostel-cafeteria.controller';

@Module({
  controllers: [BookMetadataController, BookCopyController, BorrowingController],
  providers: [BookMetadataService, BookCopyService, BorrowingService],
  exports: [BookMetadataService, BookCopyService, BorrowingService],
})
export class LibraryModule {}