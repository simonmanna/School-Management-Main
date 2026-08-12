import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Op types an offline device may push. Each maps to an existing service call. */
export const SYNC_OP_TYPES = [
  'cash_session.open',
  'cash_session.close',
  'cash_session.movement',
  'sale.checkout',
  'tab.settle',
  'sale.refund',
  'sale.void',
  'reservation.create',
  'reservation.seat',
  'reservation.cancel',
  'reservation.noShow',
  'customer.upsert',
  'customer.delete',
  'setting.set',
  // Master-data authoring (both modes). Client-minted UUID == server id.
  'menuCategory.upsert',
  'menuCategory.delete',
  'menuItem.upsert',
  'menuItem.delete',
  'modifierGroup.upsert',
  'modifierGroup.delete',
  'accompanimentGroup.upsert',
  'accompanimentGroup.delete',
  'tax.upsert',
  'tax.delete',
  'product.upsert',
  'product.delete',
  'productCategory.upsert',
  'productCategory.delete',
  'cashRegister.upsert',
  'cashRegister.delete',
  'posTable.upsert',
  'posTable.delete',
  // Self-service staff PIN change (device hashes the new PIN, server stores it)
  'staff.pinChange',
  // Communication (Phase 5) — offline staff messaging. Client-minted message id
  // == server id, so a replayed op upserts the same row.
  'message.send',
  'message.markRead',
] as const;
export type SyncOpType = (typeof SYNC_OP_TYPES)[number];

export class RegisterDeviceDto {
  @IsString() name!: string;
  @IsOptional() @IsIn(['android', 'web']) platform?: 'android' | 'web';
  @IsOptional() @IsString() branchId?: string;
}

export class SyncOpDto {
  /** Client-minted op id — doubles as the per-op idempotency key. */
  @IsString() opId!: string;
  /** Strictly increasing per device; ops are applied in this order. */
  @IsInt() @Min(1) deviceSeq!: number;
  @IsIn(SYNC_OP_TYPES as unknown as string[]) type!: SyncOpType;
  /** Cashier this op is attributed to (PIN-verified on the device). */
  @IsString() actorUserId!: string;
  /** When the op actually happened on the device. */
  @IsISO8601() occurredAt!: string;
  /** Same shape as the corresponding online endpoint's body. May carry
   *  `clientId` (client-minted row id) and `provisionalNumber`. */
  @IsObject() payload!: Record<string, any>;
}

export class SyncPushDto {
  @IsString() deviceId!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SyncOpDto)
  ops!: SyncOpDto[];
}

export interface SyncOpResult {
  opId: string;
  status: 'applied' | 'replayed' | 'failed';
  httpStatus: number;
  error: string | null;
  /** Server ids the device should map its local rows to. */
  mapping?: Record<string, string>;
  /** Final server-allocated numbers replacing provisional ones. */
  finalNumbers?: Record<string, string>;
}

export interface SyncPushResult {
  results: SyncOpResult[];
  /** Highest deviceSeq now durably applied. */
  lastPushSeq: number;
  serverTime: string;
}

/** Scopes a device may pull. */
export const SYNC_PULL_SCOPES = [
  'menuItems',
  'menuCategories',
  'modifierGroups',
  'taxes',
  'posTables',
  'cashRegisters',
  'staff',
  'settings',
  'products',
  'productCategories',
  'productPackagings',
  'partners',
  'reservations',
  // Communication (Phase 5). `conversations` is master-data-shaped (time
  // watermark); `messages` is high-volume append-only and uses a seq cursor.
  'conversations',
  'messages',
] as const;
export type SyncPullScope = (typeof SYNC_PULL_SCOPES)[number];
