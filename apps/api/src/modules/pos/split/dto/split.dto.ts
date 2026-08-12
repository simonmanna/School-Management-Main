import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

/** One {source item, quantity} assignment instruction. */
export class SplitItemDto {
  @ApiProperty() @IsString() sourceItemId!: string;
  @ApiProperty() @IsNumber() @Min(0.000001) quantity!: number;
}

export class AddBillsDto {
  @ApiProperty({ required: false, description: 'How many empty bills to create (default 1).' })
  @IsOptional() @IsInt() @Min(1) count?: number;
}

export class AssignItemsDto {
  @ApiProperty({ type: [SplitItemDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => SplitItemDto)
  items!: SplitItemDto[];
}
