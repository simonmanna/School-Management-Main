import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { InvoiceLineDto } from '../../invoice/dto/invoice.dto';

export class CreateCreditNoteDto {
  @IsString()
  partnerId!: string;

  @IsDateString()
  issueDate!: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Optional: the sales invoice this credit note reverses/reduces. */
  @IsOptional()
  @IsString()
  reversedDocumentId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];
}
