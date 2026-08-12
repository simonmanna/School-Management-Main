import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export const INVENTORY_COUNT_TYPES = ['opening', 'closing'] as const;
export type InventoryCountTypeDto = (typeof INVENTORY_COUNT_TYPES)[number];

/** Start (or resume) a count for a location + type. */
export class StartCountDto {
  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsOptional()
  @IsIn([...INVENTORY_COUNT_TYPES])
  countType?: InventoryCountTypeDto;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** One counted row in a draft save. `countedQty` null = not yet counted. */
export class SaveCountLineDto {
  @IsString()
  @IsNotEmpty()
  lineId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  countedQty?: number | null;

  @IsOptional()
  @IsString()
  reason?: string;
}

/** Persist the supervisor's in-progress counts (upsert per line). */
export class SaveCountDraftDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveCountLineDto)
  lines!: SaveCountLineDto[];

  /** User-visible label e.g. "Opening Count – Jul 01, 2026". */
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * Submit a count. A physical count overwrites system on-hand, so any movement
 * that happened AFTER a line was physically counted would be silently absorbed
 * into the variance (masking shrinkage, or erasing real sales). Submit therefore
 * refuses when such movements exist unless the supervisor explicitly accepts
 * them via `force`.
 */
export class SubmitCountDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  /** Required when `force` is true — recorded on the session and audited. */
  @IsOptional()
  @IsString()
  forceReason?: string;
}
