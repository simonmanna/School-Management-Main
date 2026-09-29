import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const CARE_MOODS = ['happy', 'settled', 'tired', 'tearful', 'unsettled', 'unwell'] as const;
export const MEAL_PORTIONS = ['all', 'most', 'some', 'none'] as const;
export const MEAL_SLOTS = ['breakfast', 'lunch', 'snack', 'other'] as const;
export const PICKUP_KINDS = ['STANDING', 'ONE_OFF'] as const;
export const INCIDENT_KINDS = ['INJURY', 'ILLNESS', 'BEHAVIOUR', 'SAFEGUARDING', 'NEAR_MISS', 'OTHER'] as const;
export const INCIDENT_SEVERITIES = ['MINOR', 'MODERATE', 'SERIOUS'] as const;
export const NOTIFY_CHANNELS = ['in_person', 'phone', 'sms', 'whatsapp', 'portal'] as const;

export class CareMealDto {
  @IsIn([...MEAL_SLOTS]) meal!: (typeof MEAL_SLOTS)[number];
  @IsIn([...MEAL_PORTIONS]) portion!: (typeof MEAL_PORTIONS)[number];
  @IsOptional() @IsString() note?: string;
}

export class CareNapDto {
  /** Local clock time, `HH:mm`, as the room observed it. */
  @IsString() @IsNotEmpty() from!: string;
  @IsOptional() @IsString() to?: string;
}

/**
 * One child's day. `onDate` is date-only; the service normalizes it so the
 * one-log-per-child-per-day unique index cannot be defeated by a time component.
 */
export class UpsertCareLogDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsDateString() onDate!: string;
  @IsOptional() @IsIn([...CARE_MOODS]) arrivalMood?: (typeof CARE_MOODS)[number];
  @IsOptional() @IsIn([...CARE_MOODS]) departureMood?: (typeof CARE_MOODS)[number];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CareMealDto) meals?: CareMealDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CareNapDto) naps?: CareNapDto[];
  @IsOptional() @IsInt() @Min(0) @Max(20) nappyChanges?: number;
  @IsOptional() @IsBoolean() usedToiletAlone?: boolean;
  @IsOptional() @IsString() activities?: string;
  @IsOptional() @IsString() teacherNote?: string;
}

export class CreatePickupAuthorizationDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsOptional() @IsIn([...PICKUP_KINDS]) kind?: (typeof PICKUP_KINDS)[number];
  @IsOptional() @IsString() contactId?: string;
  @IsOptional() @IsString() personName?: string;
  @IsOptional() @IsString() personPhone?: string;
  @IsOptional() @IsString() relationship?: string;
  @IsOptional() @IsString() idType?: string;
  @IsOptional() @IsString() idNumber?: string;
  @IsOptional() @IsString() photoDocumentId?: string;
  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @IsDateString() validTo?: string;
  @IsOptional() @IsString() notes?: string;
}

export class RevokePickupAuthorizationDto {
  @IsString() @IsNotEmpty() reason!: string;
}

export class ReleaseChildDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  /** A guardian of this child flagged `canPickup` — the ordinary handover (audit F06). */
  @IsOptional() @IsString() studentGuardianId?: string;
  /** The authorization checked at the gate. Omit only with a guardian or an override reason. */
  @IsOptional() @IsString() authorizationId?: string;
  /** Generated per click by the gate screen, so a retry cannot record a second handover. */
  @IsOptional() @IsString() idempotencyKey?: string;
  @IsOptional() @IsString() collectedByName?: string;
  @IsOptional() @IsDateString() collectedAt?: string;
  /**
   * Required when no valid authorization is named. A child must be releasable in
   * a real emergency; it must never happen without a written reason.
   */
  @IsOptional() @IsString() overrideReason?: string;
  @IsOptional() @IsString() notes?: string;
}

export class CreateIncidentDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsIn([...INCIDENT_KINDS]) kind!: (typeof INCIDENT_KINDS)[number];
  @IsOptional() @IsIn([...INCIDENT_SEVERITIES]) severity?: (typeof INCIDENT_SEVERITIES)[number];
  @IsDateString() occurredAt!: string;
  @IsOptional() @IsString() location?: string;
  @IsString() @IsNotEmpty() description!: string;
  @IsOptional() @IsString() actionTaken?: string;
  @IsOptional() @IsString() bodyPart?: string;
  @IsOptional() @IsString() firstAidById?: string;
}

export class NotifyGuardianDto {
  @IsIn([...NOTIFY_CHANNELS]) how!: (typeof NOTIFY_CHANNELS)[number];
  @IsOptional() @IsDateString() at?: string;
}

export class ReviewIncidentDto {
  @IsOptional() @IsString() reviewNotes?: string;
}

export class UpsertImmunisationDto {
  @IsString() @IsNotEmpty() studentProfileId!: string;
  @IsString() @IsNotEmpty() vaccine!: string;
  @IsOptional() @IsString() doseLabel?: string;
  @IsOptional() @IsDateString() administeredOn?: string;
  @IsOptional() @IsDateString() nextDueOn?: string;
  @IsOptional() @IsString() certificateDocumentId?: string;
  @IsOptional() @IsString() exemptionReason?: string;
  @IsOptional() @IsString() notes?: string;
}

/** Wave 16: a guardian asks, from the parent portal, for another adult to collect. */
export class PortalPickupRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(120) personName!: string;
  @Matches(/^(\+?256|0)7\d{8}$/, { message: 'personPhone must be a Ugandan mobile number' }) personPhone!: string;
  @IsString() @IsNotEmpty() @MaxLength(40) relationship!: string;
  @IsOptional() @IsString() @MaxLength(40) idType?: string;
  @IsOptional() @IsString() @MaxLength(60) idNumber?: string;
  @IsOptional() @IsIn(['STANDING', 'ONE_OFF']) kind?: 'STANDING' | 'ONE_OFF';
  @IsOptional() @IsString() validFrom?: string;
  @IsOptional() @IsString() validTo?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}
