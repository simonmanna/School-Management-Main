/**
 * POS Phase T1 — Table Reservations controller.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import {
  PosReservationsService,
  type CreateReservationDto,
} from './pos-reservations.service';

class CreateReservationBody implements CreateReservationDto {
  @ApiProperty() @IsString() tableId!: string;
  @ApiProperty() @IsString() customerName!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() phone?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() email?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) partySize?: number;
  @ApiProperty() @IsDateString() startAt!: string;
  @ApiProperty() @IsDateString() endAt!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() notes?: string;
}

class UpdateReservationBody {
  @ApiProperty({ required: false }) @IsOptional() @IsString() customerName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() phone?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() email?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) partySize?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() startAt?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() endAt?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() notes?: string;
}

class SeatBody {
  @ApiProperty({ required: false }) @IsOptional() @IsString() orderId?: string;
}

@ApiTags('pos/reservations')
@ApiBearerAuth()
@Controller('pos/reservations')
export class PosReservationsController {
  constructor(private readonly svc: PosReservationsService) {}

  @Get()
  @RequirePermissions('tables:view')
  list(
    @Query('date') date?: string,
    @Query('status') status?: string,
    @Query('tableId') tableId?: string,
  ) {
    return this.svc.list({ date, status, tableId });
  }

  @Get(':id')
  @RequirePermissions('tables:view')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  @RequirePermissions('tables:reserve')
  create(@Body() dto: CreateReservationBody) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('tables:reserve')
  update(@Param('id') id: string, @Body() dto: UpdateReservationBody) {
    return this.svc.update(id, dto);
  }

  @Post(':id/seat')
  @RequirePermissions('tables:reserve')
  seat(@Param('id') id: string, @Body() dto: SeatBody) {
    return this.svc.seat(id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('tables:reserve')
  cancel(@Param('id') id: string) {
    return this.svc.cancel(id);
  }

  @Post(':id/no-show')
  @RequirePermissions('tables:reserve')
  noShow(@Param('id') id: string) {
    return this.svc.markNoShow(id);
  }

  @Post(':id/complete')
  @RequirePermissions('tables:reserve')
  complete(@Param('id') id: string) {
    return this.svc.complete(id);
  }
}