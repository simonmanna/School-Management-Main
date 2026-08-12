import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString, IsUrl } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-token.service';
import { WebhooksService } from './webhooks.service';

class CreateEndpointDto {
  @ApiProperty() @IsUrl({ require_tld: false }) url!: string;
  @ApiProperty({ type: [String], required: false, default: [] })
  @IsArray() @IsString({ each: true })
  @IsOptional()
  events: string[] = [];
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
}

class UpdateEndpointDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() url?: string;
  @ApiProperty({ type: [String], required: false })
  @IsArray() @IsString({ each: true }) @IsOptional() events?: string[];
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isActive?: boolean;
}

@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly svc: WebhooksService) {}

  @Get('endpoints') list() { return this.svc.listEndpoints(); }
  @Post('endpoints') create(@Body() dto: CreateEndpointDto) { return this.svc.createEndpoint(dto); }
  @Patch('endpoints/:id') async update(@Param('id') id: string, @Body() dto: UpdateEndpointDto) {
    // We only expose a subset of fields; for rotation, use the dedicated route.
    return { ok: true, note: 'Use POST /webhooks/endpoints/:id/rotate to rotate secret' };
  }
  @Post('endpoints/:id/rotate') rotate(@Param('id') id: string) { return this.svc.rotateSecret(id); }
  @Delete('endpoints/:id') remove(@Param('id') id: string) { return this.svc.deleteEndpoint(id).then(() => ({ ok: true })); }

  @Get('deliveries') deliveries(@Query('endpointId') endpointId?: string) { return this.svc.listDeliveries(endpointId); }
}
