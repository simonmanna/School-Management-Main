import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-token.service';
import { ApprovalsService } from './approvals.service';

class DecideDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  status!: 'approved' | 'rejected';

  @ApiProperty({ required: false })
  @IsOptional() @IsString()
  comment?: string;
}

class RequestApprovalDto {
  @ApiProperty({ example: 'expense' })
  @IsString() entityType!: string;
  @ApiProperty() @IsString() entityId!: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  snapshot!: Record<string, unknown>;
  @ApiProperty({ required: false }) @IsOptional() @IsString() policyId?: string;
}

class ListQuery {
  @ApiProperty({ required: false, enum: ['pending', 'approved', 'rejected', 'cancelled'] })
  @IsOptional() @IsIn(['pending', 'approved', 'rejected', 'cancelled'])
  status?: 'pending' | 'approved' | 'rejected' | 'cancelled';
  @ApiProperty({ required: false }) @IsOptional() @IsString() entityType?: string;
}

@ApiTags('approvals')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  list(@Query() q: ListQuery) {
    return this.approvals.list(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.approvals.findOne(id);
  }

  @Post('request')
  request(@Body() dto: RequestApprovalDto) {
    return this.approvals.requestApproval(dto);
  }

  @Post(':id/decide')
  decide(@Param('id') id: string, @Body() dto: DecideDto) {
    return this.approvals.decide({ requestId: id, ...dto });
  }
}
