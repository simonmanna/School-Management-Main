import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested,
} from 'class-validator';

export const PROMOTION_OUTCOMES = ['promote', 'repeat', 'graduate', 'review'] as const;
export const PROMOTION_DECISION_STATUS = ['approved', 'rejected'] as const;

export class ProposePromotionsDto {
  @IsString() @IsNotEmpty() resultSetId!: string;
}

export class PromotionDecisionRowDto {
  @IsString() @IsNotEmpty() id!: string;
  @IsIn([...PROMOTION_DECISION_STATUS]) status!: (typeof PROMOTION_DECISION_STATUS)[number];
  /** Omit to accept the computed recommendation as it stands. */
  @IsOptional() @IsIn([...PROMOTION_OUTCOMES]) decision?: (typeof PROMOTION_OUTCOMES)[number];
  @IsOptional() @IsString() toClassId?: string;
  @IsOptional() @IsString() toGradeLevelId?: string;
  /// Required when the target class is organised into sections or streams.
  @IsOptional() @IsString() toSectionId?: string;
  @IsOptional() @IsString() toStreamId?: string;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class DecidePromotionDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500)
  @ValidateNested({ each: true }) @Type(() => PromotionDecisionRowDto)
  rows!: PromotionDecisionRowDto[];
}

export class ApplyPromotionDto {
  @IsString() @IsNotEmpty() resultSetId!: string;
  /** The term the promoted learners take a seat in. Required for promote/repeat. */
  @IsOptional() @IsString() toTermId?: string;
  @IsOptional() @IsISO8601() effectiveFrom?: string;
  /** Omit to apply every approved decision in the set. */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) decisionIds?: string[];
}
