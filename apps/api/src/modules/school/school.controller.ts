import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString } from 'class-validator';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { SchoolService } from './school.service';

class EnrollDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() studentPartnerId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() firstName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() lastName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() email?: string;
  @ApiProperty() @IsString() className!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() grade?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() guardianEmail?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() guardianPhone?: string;
}

class FeeLine {
  @ApiProperty() @IsString() description!: string;
  @ApiProperty() @IsNumber() amount!: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() taxId?: string;
}

class IssueTermFeesDto {
  @ApiProperty() @IsString() studentId!: string;
  @ApiProperty() @IsString() term!: string;
  @ApiProperty({ type: [FeeLine] }) @IsArray() @ArrayMinSize(1) fees!: FeeLine[];
  @ApiProperty({ required: false }) @IsOptional() @IsString() dueDate?: string;
}

class RecordPaymentDto {
  @ApiProperty() @IsString() studentId!: string;
  @ApiProperty() @IsString() invoiceId!: string;
  @ApiProperty() @IsNumber() amount!: number;
  @ApiProperty({ required: false, enum: ['cash', 'bank', 'mobile_money'] }) @IsOptional() @IsString() method?: 'cash' | 'bank' | 'mobile_money';
  @ApiProperty({ required: false }) @IsOptional() @IsString() reference?: string;
}

@ApiTags('school')
@ApiBearerAuth()
@Controller('school')
export class SchoolController {
  constructor(private readonly svc: SchoolService) {}

  @Post('enroll')
  @RequirePermissions('school:enroll')
  enroll(@Body() dto: EnrollDto) {
    return this.svc.enroll(dto);
  }

  @Get('enrollments')
  @RequirePermissions('school:read')
  enrollments() {
    return this.svc.listEnrollments();
  }

  @Post('fees/issue')
  @RequirePermissions('school:issue_term_fees')
  issue(@Body() dto: IssueTermFeesDto) {
    return this.svc.issueTermFees(dto);
  }

  @Post('fees/payment')
  @RequirePermissions('school:record_payment')
  payment(@Body() dto: RecordPaymentDto) {
    return this.svc.recordFeePayment(dto);
  }

  @Get('students/:id/statement')
  @RequirePermissions('school:read')
  statement(@Param('id') id: string) {
    return this.svc.feeStatement(id);
  }
}
