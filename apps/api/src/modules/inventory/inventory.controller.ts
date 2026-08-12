import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { Idempotent } from '../../kernel/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../kernel/idempotency/idempotency.interceptor';
import { LocationService } from './location.service';
import { StockService } from './stock.service';
import { StockDocService } from './stock-doc.service';
import { InventoryQueryService } from './inventory-query.service';
import { InventoryQueryDto } from './dto/inventory-query.dto';
import { DirectStockService } from './direct-stock.service';
import { DirectStockInDto, DirectStockOutDto, StockLedgerQueryDto } from './dto/direct-stock.dto';
import { CreateLocationDto, UpdateLocationDto, LocationQueryDto } from './dto/location.dto';
import { ReceiveStockDto, IssueStockDto, AdjustStockDto, TransferStockDto } from './dto/stock.dto';
import {
  CreateStockOutDto,
  CreateWasteDto,
  CreateStockAdjustmentDto,
  CreateStockTransferDto,
} from './dto/stock-doc.dto';

@Controller('inventory')
@UseInterceptors(IdempotencyInterceptor)
export class InventoryController {
  constructor(
    private readonly locations: LocationService,
    private readonly stock: StockService,
    private readonly stockDocs: StockDocService,
    private readonly queries: InventoryQueryService,
    private readonly directStock: DirectStockService,
  ) {}

  // ---- Locations ----

  @Get('locations')
  @RequirePermissions(PERMISSIONS.inventoryLocation.read)
  listLocations(@Query() query: LocationQueryDto) {
    return this.locations.list(query);
  }

  @Get('locations/:id')
  @RequirePermissions(PERMISSIONS.inventoryLocation.read)
  findLocation(@Param('id') id: string) {
    return this.locations.findOne(id);
  }

  @Post('locations')
  @RequirePermissions(PERMISSIONS.inventoryLocation.create)
  createLocation(@Body() dto: CreateLocationDto) {
    return this.locations.create(dto);
  }

  @Patch('locations/:id')
  @RequirePermissions(PERMISSIONS.inventoryLocation.update)
  updateLocation(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.locations.update(id, dto);
  }

  @Delete('locations/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.inventoryLocation.delete)
  removeLocation(@Param('id') id: string) {
    return this.locations.remove(id);
  }

  // ---- Stock Operations ----

  @Post('stock/receive')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.inventory.move)
  receive(@Body() dto: ReceiveStockDto) {
    return this.stock.receive(dto);
  }

  @Post('stock/issue')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.inventory.move)
  issue(@Body() dto: IssueStockDto) {
    return this.stock.issue(dto);
  }

  @Post('stock/adjust')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.inventory.move)
  adjust(@Body() dto: AdjustStockDto) {
    return this.stock.adjust(dto);
  }

  @Post('stock/transfer')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.inventory.move)
  transfer(@Body() dto: TransferStockDto) {
    return this.stock.transfer(dto);
  }

  // ---- Direct Stock In / Out ----

  @Post('direct-stock/in')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.inventory.move)
  directStockIn(@Body() dto: DirectStockInDto) {
    return this.directStock.directIn(dto);
  }

  @Post('direct-stock/out')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.inventory.move)
  directStockOut(@Body() dto: DirectStockOutDto) {
    return this.directStock.directOut(dto);
  }

  // ---- Query Endpoints ----

  @Get('items')
  @RequirePermissions(PERMISSIONS.inventory.read)
  listItems(@Query() query: InventoryQueryDto) {
    return this.queries.listItems(query);
  }

  @Get('items/:productId')
  @RequirePermissions(PERMISSIONS.inventory.read)
  itemDetail(@Param('productId') productId: string, @Query('locationId') locationId?: string) {
    return this.queries.getItemDetail(productId, locationId);
  }

  @Get('stats')
  @RequirePermissions(PERMISSIONS.inventory.read)
  stats() {
    return this.queries.getStockStats();
  }

  @Get('product-stock-levels')
  @RequirePermissions(PERMISSIONS.inventory.read)
  productStockLevels(@Query() query: InventoryQueryDto) {
    return this.queries.listProductStockLevels(query);
  }

  @Get('ledger')
  @RequirePermissions(PERMISSIONS.inventory.read)
  ledger(@Query() query: StockLedgerQueryDto) {
    return this.queries.getLedger(query);
  }

  // ---- F.8 Reports ----

  @Get('reports/expiring')
  @RequirePermissions(PERMISSIONS.inventory.read)
  expiring(@Query() query: { days?: string; locationId?: string }) {
    return this.queries.getExpiringBatches(query);
  }

  @Get('reports/reorder')
  @RequirePermissions(PERMISSIONS.inventory.read)
  reorder(@Query() query: { locationId?: string }) {
    return this.queries.getReorderSuggestions(query);
  }

  @Get('reports/movements')
  @RequirePermissions(PERMISSIONS.inventory.read)
  movements(@Query() query: { start?: string; end?: string; locationId?: string }) {
    return this.queries.getMovementSummary(query);
  }

  @Get('reports/reconciliation')
  @RequirePermissions(PERMISSIONS.inventory.read)
  reconciliation(
    @Query() query: { locationId?: string; tolerance?: string; includeMatched?: string },
  ) {
    return this.queries.getStockReconciliation({
      locationId: query.locationId,
      tolerance: query.tolerance != null ? Number(query.tolerance) : undefined,
      includeMatched: query.includeMatched === 'true',
    });
  }

  /**
   * Quants sitting at negative on-hand — goods sold before they were received.
   * Sales are never blocked, so this is the operational safety net: until the
   * covering receipt lands, those units were expensed at a stale cost basis and
   * inventory is overstated by `valuationExposure`.
   */
  @Get('reports/negative-stock')
  @RequirePermissions(PERMISSIONS.inventory.read)
  negativeStock(@Query() query: { locationId?: string }) {
    return this.queries.getNegativeStock({ locationId: query.locationId });
  }

  // ---- F.8 Stock documents: StockOut ----

  @Post('stock-outs')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.inventoryDoc.create)
  createStockOut(@Body() dto: CreateStockOutDto) {
    return this.stockDocs.createStockOut(dto);
  }

  @Get('stock-outs')
  @RequirePermissions(PERMISSIONS.inventoryDoc.read)
  listStockOuts(@Query('status') status?: string) {
    return this.stockDocs.list('out', status);
  }

  @Post('stock-outs/:id/approve')
  @RequirePermissions(PERMISSIONS.inventoryDoc.approve)
  approveStockOut(@Param('id') id: string) {
    return this.stockDocs.approveStockOut(id);
  }

  // ---- F.8 Stock documents: Waste ----

  @Post('waste')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.inventoryDoc.create)
  createWaste(@Body() dto: CreateWasteDto) {
    return this.stockDocs.createWaste(dto);
  }

  @Get('waste')
  @RequirePermissions(PERMISSIONS.inventoryDoc.read)
  listWaste(@Query('status') status?: string) {
    return this.stockDocs.list('waste', status);
  }

  @Post('waste/:id/approve')
  @RequirePermissions(PERMISSIONS.inventoryDoc.approve)
  approveWaste(@Param('id') id: string) {
    return this.stockDocs.approveWaste(id);
  }

  // ---- F.8 Stock documents: Adjustment ----

  @Post('adjustments')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.inventoryDoc.create)
  createAdjustment(@Body() dto: CreateStockAdjustmentDto) {
    return this.stockDocs.createAdjustment(dto);
  }

  @Get('adjustments')
  @RequirePermissions(PERMISSIONS.inventoryDoc.read)
  listAdjustments(@Query('status') status?: string) {
    return this.stockDocs.list('adjustment', status);
  }

  @Post('adjustments/:id/approve')
  @RequirePermissions(PERMISSIONS.inventoryDoc.approve)
  approveAdjustment(@Param('id') id: string) {
    return this.stockDocs.approveAdjustment(id);
  }

  // ---- F.8 Stock documents: Transfer ----

  @Post('transfers')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.inventoryDoc.create)
  createTransfer(@Body() dto: CreateStockTransferDto) {
    return this.stockDocs.createTransfer(dto);
  }

  @Get('transfers')
  @RequirePermissions(PERMISSIONS.inventoryDoc.read)
  listTransfers(@Query('status') status?: string) {
    return this.stockDocs.list('transfer', status);
  }

  @Post('transfers/:id/approve')
  @RequirePermissions(PERMISSIONS.inventoryDoc.approve)
  approveTransfer(@Param('id') id: string) {
    return this.stockDocs.approveTransfer(id);
  }
}
