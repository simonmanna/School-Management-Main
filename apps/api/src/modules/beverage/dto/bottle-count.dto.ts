import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { BOTTLE_COUNT_TYPES, MEASUREMENT_SOURCES, type BottleCountType, type MeasurementSource } from '@erp/shared';

export class StartBottleCountDto {
  /** Location whose bottle stock is being weighed. Defaults to the active warehouse. */
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsIn([...BOTTLE_COUNT_TYPES])
  countType?: BottleCountType;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** One physical open-bottle weighing within a line (multi open-bottle support). */
export class BottleReadingDto {
  @IsNumber()
  measuredWeightG!: number;

  /** Optional physical bottle identifier for high-value liquor traceability. */
  @IsOptional()
  @IsString()
  bottleNumber?: string;

  @IsOptional()
  @IsIn([...MEASUREMENT_SOURCES])
  measurementSource?: MeasurementSource;
}

export class SaveBottleCountLineDto {
  @IsString()
  lineId!: string;

  /** Sealed / unopened full bottles counted (whole units). */
  @IsOptional()
  @IsNumber()
  sealedFullCount?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BottleReadingDto)
  readings?: BottleReadingDto[];

  @IsOptional()
  @IsString()
  reason?: string;
}

export class SaveBottleCountDraftDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveBottleCountLineDto)
  lines!: SaveBottleCountLineDto[];
}

/** Submit carries the optional manager-approval credentials (required when any
 *  line is over tolerance or physically impossible). */
export class SubmitBottleCountDto {
  @IsOptional()
  @IsString()
  approverId?: string;

  @IsOptional()
  @IsString()
  approverEmail?: string;

  @IsOptional()
  @IsString()
  managerPin?: string;
}
