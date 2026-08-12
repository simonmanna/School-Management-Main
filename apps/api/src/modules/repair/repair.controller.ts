import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { RepairService } from './repair.service';
import { RepairCatalogService } from './repair-catalog.service';
import { RepairDiagnosisService } from './repair-diagnosis.service';
import { RepairJobService } from './repair-job.service';
import { RepairPartsService } from './repair-parts.service';
import { RepairWarrantyService } from './repair-warranty.service';
import { RepairContractService } from './repair-contract.service';
import { RepairReportsService } from './repair-reports.service';
import { RepairPostingService } from './repair-posting.service';
import { RequiresModule } from '../../kernel/module-loader/requires-module.decorator';

/**
 * Repair controller — the RMMS surface:
 *   orders → items → diagnosis → quotation → jobs → parts → bill → deliver →
 *   close · technicians · labour catalog · warranties + claims · contracts +
 *   schedules · reports.
 *
 * Every route is org-scoped by the tenancy extension and gated with
 * `repair:*` permissions (registered with the ModuleRegistry).
 */
@RequiresModule('repair')
@Controller('repair')
export class RepairController {
  constructor(
    private readonly service: RepairService,
    private readonly catalog: RepairCatalogService,
    private readonly diagnosis: RepairDiagnosisService,
    private readonly jobs: RepairJobService,
    private readonly parts: RepairPartsService,
    private readonly warranties: RepairWarrantyService,
    private readonly contracts: RepairContractService,
    private readonly reports: RepairReportsService,
    private readonly posting: RepairPostingService,
  ) {}

  // ── Dashboard / reports ───────────────────────────────────────────────────

  @Get('dashboard')
  @RequirePermissions('repair:read')
  dashboard() {
    return this.reports.dashboard();
  }

  @Get('reports/operational')
  @RequirePermissions('repair:report')
  operationalReport(@Query() q: any) {
    return this.reports.operationalReport(q.from, q.to);
  }

  @Get('reports/revenue')
  @RequirePermissions('repair:report')
  revenueByMonth(@Query() q: any) {
    return this.reports.revenueByMonth(q.from, q.to);
  }

  @Get('reports/technician-load')
  @RequirePermissions('repair:report')
  technicianLoad() {
    return this.reports.technicianLoad();
  }

  @Get('reports/warranty-health')
  @RequirePermissions('repair:report')
  warrantyHealth() {
    return this.reports.warrantyHealth();
  }

  @Get('reports/contracts')
  @RequirePermissions('repair:report')
  contractsOverview() {
    return this.reports.contractsOverview();
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  @Get('orders')
  @RequirePermissions('repair:read')
  listOrders(@Query() q: any) {
    return this.service.listOrders(q);
  }

  @Get('orders/:id')
  @RequirePermissions('repair:read')
  getOrder(@Param('id') id: string) {
    return this.service.getOrder(id);
  }

  @Post('orders')
  @RequirePermissions('repair:create')
  createOrder(@Body() dto: any) {
    return this.service.createOrder(dto);
  }

  @Post('orders/:id/transition')
  @RequirePermissions('repair:manage')
  transitionOrder(@Param('id') id: string, @Body() dto: any) {
    return this.service.transitionOrder(id, dto);
  }

  @Patch('orders/:id/technician')
  @RequirePermissions('repair:assign')
  assignTechnician(@Param('id') id: string, @Body() dto: any) {
    return this.service.assignTechnician(id, dto);
  }

  @Post('orders/:id/items')
  @RequirePermissions('repair:manage')
  addItem(@Param('id') id: string, @Body() dto: any) {
    return this.service.addItem(id, dto);
  }

  @Delete('orders/items/:itemId')
  @RequirePermissions('repair:manage')
  removeItem(@Param('itemId') itemId: string) {
    return this.service.removeItem(itemId);
  }

  @Post('orders/:id/attachments')
  @RequirePermissions('repair:manage')
  addAttachment(@Param('id') id: string, @Body() dto: any) {
    return this.service.addAttachment(id, dto);
  }

  @Delete('orders/attachments/:attachmentId')
  @RequirePermissions('repair:manage')
  removeAttachment(@Param('attachmentId') attachmentId: string) {
    return this.service.removeAttachment(attachmentId);
  }

  @Post('orders/:id/notes')
  @RequirePermissions('repair:read')
  addNote(@Param('id') id: string, @Body() dto: any) {
    return this.service.addNote(id, dto);
  }

  // ── Billing ───────────────────────────────────────────────────────────────

  @Post('orders/:id/bill')
  @RequirePermissions('repair:manage')
  bill(@Param('id') id: string, @Body() dto: any) {
    return this.posting.billRepair(id, dto ?? {});
  }

  @Post('invoices/:invoiceId/pay')
  @RequirePermissions('repair:manage')
  payInvoice(@Param('invoiceId') invoiceId: string, @Body() dto: any) {
    return this.posting.receivePayment(invoiceId, dto ?? {});
  }

  // ── Diagnosis ─────────────────────────────────────────────────────────────

  @Post('orders/:id/diagnosis')
  @RequirePermissions('repair:diagnose')
  createDiagnosis(@Param('id') id: string, @Body() dto: any) {
    return this.diagnosis.createDiagnosis(id, dto);
  }

  @Patch('diagnosis/:id')
  @RequirePermissions('repair:diagnose')
  updateDiagnosis(@Param('id') id: string, @Body() dto: any) {
    return this.diagnosis.updateDiagnosis(id, dto);
  }

  // ── Quotations ────────────────────────────────────────────────────────────

  @Get('quotations')
  @RequirePermissions('repair:quote')
  listQuotations(@Query() q: any) {
    return this.diagnosis.listQuotations(q);
  }

  @Get('quotations/:id')
  @RequirePermissions('repair:quote')
  getQuotation(@Param('id') id: string) {
    return this.diagnosis.getQuotation(id);
  }

  @Post('orders/:id/quotations')
  @RequirePermissions('repair:quote')
  createQuotation(@Param('id') id: string, @Body() dto: any) {
    return this.diagnosis.createQuotation(id, dto);
  }

  @Post('quotations/:id/submit')
  @RequirePermissions('repair:quote')
  submitQuotation(@Param('id') id: string) {
    return this.diagnosis.submitQuotation(id);
  }

  @Post('quotations/:id/approve')
  @RequirePermissions('repair:approve')
  approveQuotation(@Param('id') id: string, @Body() dto: any) {
    return this.diagnosis.approveQuotation(id, dto);
  }

  @Post('quotations/:id/reject')
  @RequirePermissions('repair:quote')
  rejectQuotation(@Param('id') id: string, @Body() dto: any) {
    return this.diagnosis.rejectQuotation(id, dto);
  }

  @Post('quotations/:id/revise')
  @RequirePermissions('repair:quote')
  reviseQuotation(@Param('id') id: string, @Body() dto: any) {
    return this.diagnosis.reviseQuotation(id, dto);
  }

  @Delete('quotations/:id')
  @RequirePermissions('repair:quote')
  deleteQuotation(@Param('id') id: string) {
    return this.diagnosis.deleteQuotation(id);
  }

  // ── Jobs ──────────────────────────────────────────────────────────────────

  @Get('jobs')
  @RequirePermissions('repair:read')
  listJobs(@Query() q: any) {
    return this.jobs.listJobs(q);
  }

  @Get('jobs/:id')
  @RequirePermissions('repair:read')
  getJob(@Param('id') id: string) {
    return this.jobs.getJob(id);
  }

  @Post('orders/:id/jobs')
  @RequirePermissions('repair:work')
  createJob(@Param('id') id: string, @Body() dto: any) {
    return this.jobs.createJob(id, dto);
  }

  @Patch('jobs/:id')
  @RequirePermissions('repair:work')
  updateJob(@Param('id') id: string, @Body() dto: any) {
    return this.jobs.updateJob(id, dto);
  }

  @Post('jobs/:id/start')
  @RequirePermissions('repair:work')
  startJob(@Param('id') id: string) {
    return this.jobs.startJob(id);
  }

  @Post('jobs/:id/complete')
  @RequirePermissions('repair:work')
  completeJob(@Param('id') id: string, @Body() dto: any) {
    return this.jobs.completeJob(id, dto);
  }

  @Post('jobs/:id/test')
  @RequirePermissions('repair:test')
  testJob(@Param('id') id: string) {
    return this.jobs.testJob(id);
  }

  @Post('jobs/:id/cancel')
  @RequirePermissions('repair:work')
  cancelJob(@Param('id') id: string, @Body() dto: any) {
    return this.jobs.cancelJob(id, dto);
  }

  @Post('jobs/:id/checklist')
  @RequirePermissions('repair:work')
  setChecklistItem(@Param('id') id: string, @Body() dto: any) {
    return this.jobs.setChecklistItem(id, dto);
  }

  // ── Parts ─────────────────────────────────────────────────────────────────

  @Get('parts')
  @RequirePermissions('repair:parts')
  listParts(@Query() q: any) {
    return this.parts.listParts(q);
  }

  @Post('orders/:id/parts')
  @RequirePermissions('repair:parts')
  reservePart(@Param('id') id: string, @Body() dto: any) {
    return this.parts.reservePart(id, dto);
  }

  @Post('parts/:id/issue')
  @RequirePermissions('repair:parts')
  issuePart(@Param('id') id: string, @Body() dto: any) {
    return this.parts.issuePart(id, dto);
  }

  @Delete('parts/:id')
  @RequirePermissions('repair:parts')
  deletePart(@Param('id') id: string) {
    return this.parts.deletePart(id);
  }

  // ── Labour catalog ────────────────────────────────────────────────────────

  @Get('labour-types')
  @RequirePermissions('repair:read')
  listLabourTypes(@Query() q: any) {
    return this.catalog.listLabourTypes(q);
  }

  @Post('labour-types')
  @RequirePermissions('repair:manage')
  createLabourType(@Body() dto: any) {
    return this.catalog.createLabourType(dto);
  }

  @Patch('labour-types/:id')
  @RequirePermissions('repair:manage')
  updateLabourType(@Param('id') id: string, @Body() dto: any) {
    return this.catalog.updateLabourType(id, dto);
  }

  @Delete('labour-types/:id')
  @RequirePermissions('repair:manage')
  deleteLabourType(@Param('id') id: string) {
    return this.catalog.deleteLabourType(id);
  }

  // ── Technicians ───────────────────────────────────────────────────────────

  @Get('technicians')
  @RequirePermissions('repair:read')
  listTechnicians(@Query() q: any) {
    return this.catalog.listTechnicians(q);
  }

  @Post('technicians')
  @RequirePermissions('repair:manage')
  createTechnician(@Body() dto: any) {
    return this.catalog.createTechnician(dto);
  }

  @Patch('technicians/:id')
  @RequirePermissions('repair:manage')
  updateTechnician(@Param('id') id: string, @Body() dto: any) {
    return this.catalog.updateTechnician(id, dto);
  }

  @Delete('technicians/:id')
  @RequirePermissions('repair:manage')
  deleteTechnician(@Param('id') id: string) {
    return this.catalog.deleteTechnician(id);
  }

  // ── Warranties ────────────────────────────────────────────────────────────

  @Get('warranties')
  @RequirePermissions('repair:warranty')
  listWarranties(@Query() q: any) {
    return this.warranties.listWarranties(q);
  }

  @Post('warranties')
  @RequirePermissions('repair:warranty')
  createWarranty(@Body() dto: any) {
    return this.warranties.createWarranty(dto);
  }

  @Patch('warranties/:id')
  @RequirePermissions('repair:warranty')
  updateWarranty(@Param('id') id: string, @Body() dto: any) {
    return this.warranties.updateWarranty(id, dto);
  }

  @Post('warranties/:id/claims')
  @RequirePermissions('repair:warranty')
  createClaim(@Param('id') id: string, @Body() dto: any) {
    return this.warranties.createClaim(id, dto);
  }

  @Patch('claims/:claimId')
  @RequirePermissions('repair:warranty')
  resolveClaim(@Param('claimId') claimId: string, @Body() dto: any) {
    return this.warranties.resolveClaim(claimId, dto);
  }

  // ── Service contracts ─────────────────────────────────────────────────────

  @Get('contracts')
  @RequirePermissions('repair:contract')
  listContracts(@Query() q: any) {
    return this.contracts.listContracts(q);
  }

  @Post('contracts')
  @RequirePermissions('repair:contract')
  createContract(@Body() dto: any) {
    return this.contracts.createContract(dto);
  }

  @Patch('contracts/:id')
  @RequirePermissions('repair:contract')
  updateContract(@Param('id') id: string, @Body() dto: any) {
    return this.contracts.updateContract(id, dto);
  }

  @Post('contracts/:id/activate')
  @RequirePermissions('repair:contract')
  activateContract(@Param('id') id: string) {
    return this.contracts.activateContract(id);
  }

  @Post('contracts/:id/cancel')
  @RequirePermissions('repair:contract')
  cancelContract(@Param('id') id: string, @Body() dto: any) {
    return this.contracts.cancelContract(id, dto);
  }

  @Delete('contracts/:id')
  @RequirePermissions('repair:contract')
  deleteContract(@Param('id') id: string) {
    return this.contracts.deleteContract(id);
  }

  // ── Preventive schedules ──────────────────────────────────────────────────

  @Get('schedules')
  @RequirePermissions('repair:schedule')
  listSchedules(@Query() q: any) {
    return this.contracts.listSchedules(q);
  }

  @Post('schedules')
  @RequirePermissions('repair:schedule')
  createSchedule(@Body() dto: any) {
    return this.contracts.createSchedule(dto);
  }

  @Patch('schedules/:id')
  @RequirePermissions('repair:schedule')
  updateSchedule(@Param('id') id: string, @Body() dto: any) {
    return this.contracts.updateSchedule(id, dto);
  }

  @Delete('schedules/:id')
  @RequirePermissions('repair:schedule')
  deleteSchedule(@Param('id') id: string) {
    return this.contracts.deleteSchedule(id);
  }
}
