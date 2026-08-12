import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { StockReservationService } from './stock-reservation.service';

class ReserveStockDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() variantId?: string;
  @IsString() locationId!: string;
  @IsPositive() quantity!: number;
  @IsString() sourceType!: string;
  @IsString() sourceId!: string;
  @IsOptional() @IsString() reason?: string;
}

class ReleaseDto {
  @IsString() sourceType!: string;
  @IsString() sourceId!: string;
}

@Controller('inventory/reservations')
export class StockReservationController {
  constructor(private readonly reservations: StockReservationService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.inventory.move)
  reserve(@Body() dto: ReserveStockDto) {
    return this.reservations.reserve(dto);
  }

  @Post('release')
  @RequirePermissions(PERMISSIONS.inventory.move)
  release(@Body() dto: ReleaseDto) {
    return this.reservations.release(dto.sourceType, dto.sourceId);
  }

  @Post('consume')
  @RequirePermissions(PERMISSIONS.inventory.move)
  consume(@Body() dto: ReleaseDto) {
    return this.reservations.consume(dto.sourceType, dto.sourceId);
  }

  /** Available-to-promise for a stock line: on-hand − active reservations. */
  @Get('atp')
  @RequirePermissions(PERMISSIONS.inventory.read)
  atp(
    @Query('productId') productId: string,
    @Query('locationId') locationId: string,
    @Query('variantId') variantId?: string,
  ) {
    return this.reservations.availableToPromise(productId, locationId, variantId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.inventory.read)
  list(@Query('sourceType') sourceType: string, @Query('sourceId') sourceId: string) {
    return this.reservations.listForSource(sourceType, sourceId);
  }
}
