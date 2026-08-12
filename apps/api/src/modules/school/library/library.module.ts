import { Module } from '@nestjs/common';
import { AccountingModule } from '../../accounting/accounting.module';
import { InvoicingModule } from '../../invoicing/invoicing.module';
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
  // BorrowingService raises a posted AR invoice for overdue fines, so it needs
  // the invoicing DocumentBuilderService + accounting PostingService.
  imports: [InvoicingModule, AccountingModule],
  controllers: [BookMetadataController, BookCopyController, BorrowingController],
  providers: [BookMetadataService, BookCopyService, BorrowingService],
  exports: [BookMetadataService, BookCopyService, BorrowingService],
})
export class LibraryModule {}