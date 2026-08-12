import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { RentalService } from './rental.service';
import { RentalCatalogService } from './rental-catalog.service';
import { RentalUnitService } from './rental-unit.service';
import { RentalAvailabilityService } from './rental-availability.service';
import { RentalReservationService } from './rental-reservation.service';
import { RentalScoreService } from './rental-score.service';
import { RentalAgreementService } from './rental-agreement.service';
import { RentalDepositService } from './rental-deposit.service';
import { RentalExtensionService } from './rental-extension.service';
import { RentalSwapService } from './rental-swap.service';
import { RentalReturnService } from './rental-return.service';
import { RentalServiceOrderService } from './rental-service-order.service';
import { RentalReportsService } from './rental-reports.service';
import { RentalLocationConfigService } from './rental-location-config.service';
import { RequiresModule } from '../../kernel/module-loader/requires-module.decorator';

/**
 * Rental controller — the full lifecycle surface:
 *   catalog → availability → reserve → score → agreement → checkout →
 *   extend/swap → return → inspect → settle → service orders → reports.
 *
 * Every route is org-scoped by the tenancy extension and gated with
 * `rental:*` permissions (registered with the ModuleRegistry).
 */
@RequiresModule('rental')
@Controller('rental')
export class RentalController {
  constructor(
    private readonly service: RentalService,
    private readonly catalog: RentalCatalogService,
    private readonly units: RentalUnitService,
    private readonly availability: RentalAvailabilityService,
    private readonly reservations: RentalReservationService,
    private readonly score: RentalScoreService,
    private readonly agreements: RentalAgreementService,
    private readonly deposit: RentalDepositService,
    private readonly extensions: RentalExtensionService,
    private readonly swaps: RentalSwapService,
    private readonly returns: RentalReturnService,
    private readonly serviceOrders: RentalServiceOrderService,
    private readonly reports: RentalReportsService,
    private readonly locations: RentalLocationConfigService,
  ) {}

  // ── Catalog ──────────────────────────────────────────────────────────────

  @Get('catalog')
  @RequirePermissions('rental:read')
  listCatalog(@Query() q: any) {
    const [rates, packages] = [this.catalog.listRates(q.productId), this.catalog.listPackages(q.includeInactive === 'true')];
    return Promise.all([rates, packages]).then(([ratesList, packagesList]) => ({ rates: ratesList, packages: packagesList }));
  }

  @Post('rates')
  @RequirePermissions('rental:manage')
  createRate(@Body() dto: any) {
    return this.catalog.upsertRate(dto);
  }

  @Patch('rates/:id')
  @RequirePermissions('rental:manage')
  updateRate(@Param('id') id: string, @Body() dto: any) {
    return this.catalog.updateRate(id, dto);
  }

  @Delete('rates/:id')
  @RequirePermissions('rental:manage')
  deleteRate(@Param('id') id: string) {
    return this.catalog.deleteRate(id);
  }

  @Post('packages')
  @RequirePermissions('rental:manage')
  createPackage(@Body() dto: any) {
    return this.catalog.createPackage(dto);
  }

  @Patch('packages/:id')
  @RequirePermissions('rental:manage')
  updatePackage(@Param('id') id: string, @Body() dto: any) {
    return this.catalog.updatePackage(id, dto);
  }

  @Delete('packages/:id')
  @RequirePermissions('rental:manage')
  deletePackage(@Param('id') id: string) {
    return this.catalog.deletePackage(id);
  }

  // ── Units ────────────────────────────────────────────────────────────────

  @Get('units')
  @RequirePermissions('rental:read')
  listUnits(@Query() q: any) {
    return this.units.list(q);
  }

  @Post('units/generate')
  @RequirePermissions('rental:manage')
  generateUnits(@Body() dto: any) {
    return this.units.bulkGenerate(dto);
  }

  @Patch('units/:id')
  @RequirePermissions('rental:manage')
  updateUnit(@Param('id') id: string, @Body() dto: any) {
    return this.units.update(id, dto);
  }

  @Post('units/:id/retire')
  @RequirePermissions('rental:manage')
  retireUnit(@Param('id') id: string, @Body() dto: any) {
    return this.units.retire(id, dto?.notes);
  }

  // ── Availability ─────────────────────────────────────────────────────────

  @Get('availability')
  @RequirePermissions('rental:read')
  checkAvailability(@Query() q: any) {
    if (!q.productId || !q.startAt || !q.endAt) {
      throw new BadRequestException('availability requires productId, startAt, endAt');
    }
    return this.availability.countAvailable({
      productId: q.productId,
      startAt: new Date(q.startAt),
      endAt: new Date(q.endAt),
      excludeSourceId: q.excludeSourceId,
    });
  }

  @Get('availability/units')
  @RequirePermissions('rental:read')
  availabilityUnits(@Query() q: any) {
    if (!q.productId || !q.startAt || !q.endAt) {
      throw new BadRequestException('availability/units requires productId, startAt, endAt');
    }
    return this.availability.candidateUnits({
      productId: q.productId,
      startAt: new Date(q.startAt),
      endAt: new Date(q.endAt),
      locationId: q.locationId,
    });
  }

  // ── Reservations (holds) ─────────────────────────────────────────────────

  @Get('reservations')
  @RequirePermissions('rental:read')
  listReservations(@Query() q: any) {
    return this.reservations.list(q);
  }

  @Post('reservations')
  @RequirePermissions('rental:reserve')
  createReservation(@Body() dto: any) {
    return this.reservations.create(dto);
  }

  @Post('reservations/:id/confirm')
  @RequirePermissions('rental:reserve')
  confirmReservation(@Param('id') id: string) {
    // Holds convert to agreements at agreement-create; this endpoint is a
    // convenience that returns the current hold state.
    return this.reservations.get(id);
  }

  @Post('reservations/:id/cancel')
  @RequirePermissions('rental:reserve')
  cancelReservation(@Param('id') id: string) {
    return this.reservations.cancel(id);
  }

  // ── Score ────────────────────────────────────────────────────────────────

  @Get('scores/:partnerId')
  @RequirePermissions('rental:read')
  getScore(@Param('partnerId') partnerId: string) {
    return this.score.recompute(partnerId);
  }

  @Patch('scores/:partnerId/hold')
  @RequirePermissions('rental:manage')
  scoreHold(@Param('partnerId') partnerId: string, @Body() dto: any) {
    return this.score.setManualHold(partnerId, Boolean(dto.manualHold));
  }

  // ── Agreements ───────────────────────────────────────────────────────────

  @Get('agreements')
  @RequirePermissions('rental:read')
  listAgreements(@Query() q: any) {
    return this.agreements.list(q);
  }

  @Get('agreements/:id')
  @RequirePermissions('rental:read')
  getAgreement(@Param('id') id: string) {
    return this.agreements.get(id);
  }

  @Post('agreements')
  @RequirePermissions('rental:sign')
  createAgreement(@Body() dto: any) {
    return this.agreements.create(dto);
  }

  @Post('agreements/:id/confirm')
  @RequirePermissions('rental:sign')
  confirmAgreement(@Param('id') id: string) {
    return this.agreements.confirm(id);
  }

  @Post('agreements/:id/checkout')
  @RequirePermissions('rental:checkout')
  checkoutAgreement(@Param('id') id: string, @Body() dto: any) {
    return this.agreements.checkout(id, dto);
  }

  @Post('agreements/:id/cancel')
  @RequirePermissions('rental:sign')
  cancelAgreement(@Param('id') id: string) {
    return this.agreements.cancel(id);
  }

  // ── Deposits ─────────────────────────────────────────────────────────────

  @Get('agreements/:id/deposit')
  @RequirePermissions('rental:read')
  getDeposit(@Param('id') id: string) {
    return this.deposit.getByAgreement(id);
  }

  @Post('agreements/:id/deposit/collect')
  @RequirePermissions('rental:checkout')
  collectDeposit(@Param('id') id: string, @Body() dto: any) {
    return this.deposit.collect({ agreementId: id, ...dto });
  }

  @Post('agreements/:id/deposit/refund')
  @RequirePermissions('rental:manage')
  refundDeposit(@Param('id') id: string, @Body() dto: any) {
    return this.deposit.refund({ agreementId: id, ...dto });
  }

  @Post('agreements/:id/deposit/forfeit')
  @RequirePermissions('rental:manage')
  forfeitDeposit(@Param('id') id: string, @Body() dto: any) {
    return this.deposit.forfeit({ agreementId: id, ...dto });
  }

  // ── Extensions & swaps ───────────────────────────────────────────────────

  @Get('extensions')
  @RequirePermissions('rental:read')
  listExtensions(@Query() q: any) {
    return this.extensions.list(q);
  }

  @Post('extensions')
  @RequirePermissions('rental:manage')
  extend(@Body() dto: any) {
    return this.extensions.extend(dto);
  }

  @Get('swaps')
  @RequirePermissions('rental:read')
  listSwaps(@Query() q: any) {
    return this.swaps.list(q);
  }

  @Post('swaps')
  @RequirePermissions('rental:manage')
  swap(@Body() dto: any) {
    return this.swaps.swap(dto);
  }

  // ── Returns, inspection, settlement ──────────────────────────────────────

  @Get('returns')
  @RequirePermissions('rental:read')
  listReturns(@Query() q: any) {
    return this.returns.list(q);
  }

  @Get('returns/:id')
  @RequirePermissions('rental:read')
  getReturn(@Param('id') id: string) {
    return this.returns.get(id);
  }

  @Post('returns')
  @RequirePermissions('rental:return')
  createReturn(@Body() dto: any) {
    return this.returns.createReturn(dto);
  }

  @Post('returns/:id/inspect')
  @RequirePermissions('rental:return')
  inspectReturn(@Param('id') id: string, @Body() dto: any) {
    return this.returns.inspect({ returnId: id, ...dto });
  }

  @Post('returns/:id/settle')
  @RequirePermissions('rental:settle')
  settleReturn(@Param('id') id: string, @Body() dto: any) {
    return this.returns.settle({ returnId: id, ...dto });
  }

  @Post('damages/:id/waive')
  @RequirePermissions('rental:waive')
  waiveDamage(@Param('id') id: string, @Body() dto: any) {
    return this.returns.waiveDamage(id, dto?.reason ?? '');
  }

  // ── Service orders ───────────────────────────────────────────────────────

  @Get('service-orders')
  @RequirePermissions('rental:read')
  listServiceOrders(@Query() q: any) {
    return this.serviceOrders.list(q);
  }

  @Post('service-orders')
  @RequirePermissions('rental:manage')
  createServiceOrder(@Body() dto: any) {
    return this.serviceOrders.create(dto);
  }

  @Post('service-orders/:id/complete')
  @RequirePermissions('rental:manage')
  completeServiceOrder(@Param('id') id: string, @Body() dto: any) {
    return this.serviceOrders.complete({ id, ...dto });
  }

  @Post('service-orders/:id/cancel')
  @RequirePermissions('rental:manage')
  cancelServiceOrder(@Param('id') id: string) {
    return this.serviceOrders.cancel(id);
  }

  // ── Reports ──────────────────────────────────────────────────────────────

  @Get('reports/utilization')
  @RequirePermissions('rental:read')
  utilization(@Query() q: any) {
    return this.reports.utilization(q);
  }

  @Get('reports/revenue')
  @RequirePermissions('rental:read')
  revenue(@Query() q: any) {
    return this.reports.revenue(q);
  }

  @Get('reports/fleet')
  @RequirePermissions('rental:read')
  fleet(@Query() q: any) {
    return this.reports.fleet(q);
  }

  // ── Locations ────────────────────────────────────────────────────────────

  @Post('locations/bootstrap')
  @RequirePermissions('rental:manage')
  bootstrapLocations() {
    return this.locations.bootstrap();
  }
}
