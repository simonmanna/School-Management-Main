/** Library + Transport + Hostel + Cafeteria + Reports — fast CRUD with finance hooks. */

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type {
  Bed,
  BookCopy,
  BookMetadata,
  Borrowing,
  Dormitory,
  Room,
  HostelAllocation,
  MealAccount,
  MealPlan,
  MealPurchase,
  ReportCard,
  Route,
  RouteAssignment,
  Stop,
  StudentTransportAssignment,
  Vehicle,
} from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { DocumentBuilderService } from '../../invoicing/document/document-builder.service';
import { PostingService } from '../../accounting/posting/posting.service';
import { DmsTypeResolver } from '../../documents/dms-type-resolver.service';
import { EVENTS } from '@erp/shared';

// ═══════════════════════════════════════════════════════════════════════════
// Library
// ═══════════════════════════════════════════════════════════════════════════

@Injectable()
export class BookMetadataService extends BaseCrudService<BookMetadata, Partial<BookMetadata>, Partial<BookMetadata>> {
  protected readonly entityName = 'BookMetadata';
  protected readonly searchFields = ['isbn'];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.bookMetadata as unknown as CrudDelegate);
  }
}

@Injectable()
export class BookCopyService extends BaseCrudService<BookCopy, Partial<BookCopy>, Partial<BookCopy>> {
  protected readonly entityName = 'BookCopy';
  protected readonly searchFields: string[] = [];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.bookCopy as unknown as CrudDelegate);
  }
}

@Injectable()
export class BorrowingService extends BaseCrudService<Borrowing, Partial<Borrowing>, Partial<Borrowing>> {
  protected readonly entityName = 'Borrowing';
  protected readonly searchFields: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
    private readonly documentBuilder: DocumentBuilderService,
    private readonly posting: PostingService,
    private readonly dmsTypes: DmsTypeResolver,
  ) {
    super(prisma.client.borrowing as unknown as CrudDelegate);
  }

  /** Borrow a copy to a student — flips the copy to 'borrowed'. */
  async borrow(bookCopyId: string, studentProfileId: string, dueAt: Date, notes?: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const copy = await tx.bookCopy.findFirst({ where: { id: bookCopyId } });
      if (!copy) throw new NotFoundException(`BookCopy ${bookCopyId} not found`);
      if (copy.status !== 'available') throw new BadRequestException(`BookCopy is ${copy.status}`);
      await tx.bookCopy.updateMany({ where: { id: bookCopyId }, data: { status: 'borrowed' } });
      const borrowing = await tx.borrowing.create({
        data: {
          organizationId: this.tenant.organizationId,
          bookMetadataId: copy.bookMetadataId,
          bookCopyId,
          studentProfileId,
          dueAt,
          notes: notes ?? null,
        },
      });
      this.events.publish(EVENTS.SchoolBookBorrowed, {
        organizationId: this.tenant.organizationId,
        borrowingId: borrowing.id,
        bookCopyId,
        studentProfileId,
      });
      return borrowing;
    });
  }

  /** Return a borrowed copy. If overdue, generates a fine invoice (sales_invoice). */
  async return(borrowingId: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const borrowing = await tx.borrowing.findFirst({ where: { id: borrowingId } });
      if (!borrowing) throw new NotFoundException(`Borrowing ${borrowingId} not found`);
      const now = new Date();
      const overdue = now > borrowing.dueAt;
      let fineAmount = 0;
      if (overdue) {
        const days = Math.ceil((now.getTime() - borrowing.dueAt.getTime()) / (1000 * 60 * 60 * 24));
        fineAmount = days * 200; // UGX 200 / day default
      }
      await tx.borrowing.updateMany({
        where: { id: borrowingId },
        data: { returnedAt: now, status: overdue ? 'overdue' : 'returned', fineAmount },
      });
      await tx.bookCopy.updateMany({
        where: { id: borrowing.bookCopyId },
        data: { status: 'available' },
      });

      // If overdue + has a student + has a fine, raise a posted AR invoice so
      // the fine can be collected through SchoolPaymentService like any fee.
      let invoiceId: string | null = null;
      if (overdue && borrowing.studentProfileId && fineAmount > 0) {
        const student = await tx.studentProfile.findFirst({ where: { id: borrowing.studentProfileId } });
        if (student) {
          const organizationId = this.tenant.organizationId;
          const number = await this.sequence.next(`libraryfine:${new Date().getUTCFullYear()}`, { prefix: 'LFINE-', padding: 6 }, tx);
          // H1: set documentTypeId (the required DMS FK the fork dropped — the
          // raw create used to throw) and post to the GL. The old code left the
          // fine as a never-posted 'draft', so collecting it later credited AR
          // with no offsetting debit and the books drifted. A fine has no
          // product line, so it follows the penalty pattern (raw doc + line +
          // groupForPosting), not documentBuilder.createDocument.
          const invoice = await tx.document.create({
            data: {
              organizationId,
              documentNumber: number,
              documentType: 'sales_invoice',
              documentTypeId: await this.dmsTypes.resolveIdByCode('sales_invoice', tx),
              partnerId: student.partnerId,
              issueDate: now,
              dueDate: now,
              status: 'draft',
              reference: `LIBRARY_FINE-${borrowing.id}`,
              notes: `Overdue fine for borrowed book`,
              sourceType: 'library_fine',
              sourceId: borrowing.id,
              subtotal: fineAmount,
              totalAmount: fineAmount,
              amountResidual: fineAmount,
            },
          });
          invoiceId = invoice.id;
          await tx.documentLine.create({
            data: {
              organizationId,
              documentId: invoice.id,
              description: `Library overdue fine · ${borrowing.id}`,
              quantity: 1,
              unitPrice: fineAmount,
              discountPercent: 0,
              lineNumber: 1,
              subtotal: fineAmount,
              total: fineAmount,
              taxAmount: 0,
            },
          });

          // Post Dr Receivable / Cr fine income, then promote to 'posted'.
          const full = await tx.document.findFirst({ where: { id: invoice.id }, include: { lines: true, partner: true } });
          const { counterAccount, itemByAccount } = await this.documentBuilder.groupForPosting(tx, full, 'sales');
          const journalLines: any[] = [
            { accountId: counterAccount, debit: fineAmount.toString(), partnerId: student.partnerId, description: `Library fine ${number}` },
          ];
          for (const [accountId, amount] of itemByAccount) {
            journalLines.push({ accountId, credit: amount.toString(), description: 'Library fine income' });
          }
          const entry = await this.posting.post(
            {
              journalCode: 'SALES',
              date: now,
              description: `Library fine · ${number}`,
              sourceType: 'library_fine_invoice',
              sourceId: invoice.id,
              lines: journalLines,
            },
            tx,
          );
          await tx.document.update({
            where: { id: invoice.id },
            data: { status: 'posted', paymentStatus: 'not_paid', journalEntryId: entry.id, postedAt: now },
          });

          await tx.borrowing.updateMany({
            where: { id: borrowingId },
            data: { fineInvoiceId: invoiceId },
          });
          this.events.publish(EVENTS.SchoolBookOverdueFined, {
            organizationId,
            borrowingId,
            fineAmount: fineAmount.toString(),
          });
        }
      }
      this.events.publish(EVENTS.SchoolBookReturned, {
        organizationId: this.tenant.organizationId,
        borrowingId,
      });
      return { returned: true, fineAmount, invoiceId };
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Transport
// ═══════════════════════════════════════════════════════════════════════════

@Injectable()
export class VehicleService extends BaseCrudService<Vehicle, Partial<Vehicle>, Partial<Vehicle>> {
  protected readonly entityName = 'Vehicle';
  protected readonly searchFields = ['code', 'plateNumber'];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.vehicle as unknown as CrudDelegate);
  }
}

@Injectable()
export class RouteService extends BaseCrudService<Route, Partial<Route>, Partial<Route>> {
  protected readonly entityName = 'Route';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { stops: { orderBy: { order: 'asc' } }, assignments: true };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.route as unknown as CrudDelegate);
  }
}

@Injectable()
export class StopService extends BaseCrudService<Stop, Partial<Stop>, Partial<Stop>> {
  protected readonly entityName = 'Stop';
  protected readonly searchFields = ['name'];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.stop as unknown as CrudDelegate);
  }
}

@Injectable()
export class RouteAssignmentService extends BaseCrudService<RouteAssignment, Partial<RouteAssignment>, Partial<RouteAssignment>> {
  protected readonly entityName = 'RouteAssignment';
  protected readonly searchFields: string[] = [];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.routeAssignment as unknown as CrudDelegate);
  }
}

@Injectable()
export class StudentTransportAssignmentService extends BaseCrudService<StudentTransportAssignment, Partial<StudentTransportAssignment>, Partial<StudentTransportAssignment>> {
  protected readonly entityName = 'StudentTransportAssignment';
  protected readonly searchFields: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {
    super(prisma.client.studentTransportAssignment as unknown as CrudDelegate);
  }

  async assign(studentProfileId: string, routeId: string, stopId: string, startDate: Date, monthlyFee: number) {
    const row = await this.prisma.client.studentTransportAssignment.create({
      data: {
        organizationId: this.tenant.organizationId,
        studentProfileId,
        routeId,
        stopId,
        startDate,
        monthlyFee,
      },
    });
    this.events.publish(EVENTS.SchoolTransportAssigned, {
      organizationId: this.tenant.organizationId,
      assignmentId: row.id,
      studentProfileId,
      routeId,
    });
    return row;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Hostel
// ═══════════════════════════════════════════════════════════════════════════

@Injectable()
export class DormitoryService extends BaseCrudService<Dormitory, Partial<Dormitory>, Partial<Dormitory>> {
  protected readonly entityName = 'Dormitory';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { rooms: true };
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.dormitory as unknown as CrudDelegate);
  }
}

@Injectable()
export class RoomService extends BaseCrudService<Room & { beds: Bed[] }, Partial<Room>, Partial<Room>> {
  protected readonly entityName = 'Room';
  protected readonly searchFields: string[] = [];
  protected readonly defaultInclude = { beds: true };
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.room as unknown as CrudDelegate);
  }
}

@Injectable()
export class BedService extends BaseCrudService<Bed, Partial<Bed>, Partial<Bed>> {
  protected readonly entityName = 'Bed';
  protected readonly searchFields: string[] = [];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.bed as unknown as CrudDelegate);
  }
}

@Injectable()
export class HostelAllocationService extends BaseCrudService<HostelAllocation, Partial<HostelAllocation>, Partial<HostelAllocation>> {
  protected readonly entityName = 'HostelAllocation';
  protected readonly searchFields: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {
    super(prisma.client.hostelAllocation as unknown as CrudDelegate);
  }

  async allocate(bedId: string, studentProfileId: string, startDate: Date) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const bed = await tx.bed.findFirst({ where: { id: bedId } });
      if (!bed) throw new NotFoundException(`Bed ${bedId} not found`);
      if (bed.status !== 'available') throw new BadRequestException(`Bed is ${bed.status}`);
      await tx.bed.updateMany({ where: { id: bedId }, data: { status: 'occupied' } });
      const alloc = await tx.hostelAllocation.create({
        data: {
          organizationId: this.tenant.organizationId,
          bedId,
          studentProfileId,
          startDate,
        },
      });
      this.events.publish(EVENTS.SchoolHostelAllocated, {
        organizationId: this.tenant.organizationId,
        allocationId: alloc.id,
        studentProfileId,
        bedId,
      });
      return alloc;
    });
  }

  async checkout(allocationId: string, checkOutDate: Date) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const alloc = await tx.hostelAllocation.findFirst({ where: { id: allocationId } });
      if (!alloc) throw new NotFoundException(`Allocation ${allocationId} not found`);
      await tx.hostelAllocation.updateMany({
        where: { id: allocationId },
        data: { status: 'ended', checkOutDate, endDate: checkOutDate },
      });
      await tx.bed.updateMany({ where: { id: alloc.bedId }, data: { status: 'available' } });
      return alloc;
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Cafeteria
// ═══════════════════════════════════════════════════════════════════════════

@Injectable()
export class MealPlanService extends BaseCrudService<MealPlan, Partial<MealPlan>, Partial<MealPlan>> {
  protected readonly entityName = 'MealPlan';
  protected readonly searchFields = ['name'];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.mealPlan as unknown as CrudDelegate);
  }
}

@Injectable()
export class MealAccountService extends BaseCrudService<MealAccount, Partial<MealAccount>, Partial<MealAccount>> {
  protected readonly entityName = 'MealAccount';
  protected readonly searchFields: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {
    super(prisma.client.mealAccount as unknown as CrudDelegate);
  }

  /** Top up a student's meal account (typically parent deposits cash). */
  async topUp(studentProfileId: string, mealPlanId: string, amount: number) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const account = await tx.mealAccount.upsert({
        where: { studentProfileId },
        create: {
          organizationId: this.tenant.organizationId,
          studentProfileId,
          mealPlanId,
          balance: amount,
        },
        update: {
          balance: { increment: amount },
        },
      });
      await tx.mealPurchase.create({
        data: {
          organizationId: this.tenant.organizationId,
          mealAccountId: account.id,
          amount,
          description: 'Top-up',
        },
      });
      this.events.publish(EVENTS.SchoolMealTopUp, {
        organizationId: this.tenant.organizationId,
        mealAccountId: account.id,
        amount: amount.toString(),
      });
      return account;
    });
  }

  /** Debit a meal purchase. */
  async purchase(mealAccountId: string, amount: number, description: string, paymentId?: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const account = await tx.mealAccount.findFirst({ where: { id: mealAccountId } });
      if (!account) throw new NotFoundException(`MealAccount ${mealAccountId} not found`);
      if (Number(account.balance) < amount) throw new BadRequestException('Insufficient balance');
      await tx.mealAccount.updateMany({
        where: { id: mealAccountId },
        data: { balance: { decrement: amount } },
      });
      return tx.mealPurchase.create({
        data: {
          organizationId: this.tenant.organizationId,
          mealAccountId,
          amount,
          description,
          paymentId: paymentId ?? null,
        },
      });
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SequenceService injection (needed for BorrowingService.fineInvoice numbering)
// ═══════════════════════════════════════════════════════════════════════════
// Note: BorrowingService uses SequenceService for fine-invoice numbering. We
// declare it as a constructor param in BorrowingService. Because BorrowingService
// is registered through the kernel's BaseCrudService wiring, we re-import here
// for clarity.
import { ModuleRef } from '@nestjs/core';