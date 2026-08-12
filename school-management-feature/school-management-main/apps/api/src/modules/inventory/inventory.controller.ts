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
import { InventoryQueryService } from './inventory-query.service';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';
import { ReceiveStockDto, IssueStockDto, AdjustStockDto, TransferStockDto } from './dto/stock.dto';

@Controller('inventory')
@UseInterceptors(IdempotencyInterceptor)
export class InventoryController {
  constructor(
    private readonly locations: LocationService,
    private readonly stock: StockService,
    private readonly queries: InventoryQueryService,
  ) {}

  // ---- Locations ----

  @Get('locations')
  @RequirePermissions(PERMISSIONS.inventoryLocation.read)
  listLocations(@Query() query: PaginationDto) {
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

  // ---- Query Endpoints ----

  @Get('items')
  @RequirePermissions(PERMISSIONS.inventory.read)
  listItems(@Query() query: PaginationDto & { locationId?: string; lowStock?: string }) {
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

  @Get('ledger')
  @RequirePermissions(PERMISSIONS.inventory.read)
  ledger(@Query() query: PaginationDto & { productId?: string; locationId?: string; type?: string }) {
    return this.queries.getLedger(query);
  }
}
