import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

// =============================================================================
// Enums
// =============================================================================

export enum BackupFrequency {
  Manual = 'manual',
  EveryHour = 'every_hour',
  Every2Hours = 'every_2_hours',
  Every4Hours = 'every_4_hours',
  Every6Hours = 'every_6_hours',
  Every12Hours = 'every_12_hours',
  Daily = 'daily',
  Weekly = 'weekly',
  Monthly = 'monthly',
  CustomMinutes = 'custom_minutes',
  CustomHours = 'custom_hours',
  Cron = 'cron',
}

export enum BackupType {
  Full = 'full',
  Incremental = 'incremental',
  Differential = 'differential',
  Snapshot = 'snapshot',
  Mirror = 'mirror',
}

export enum CompressionLevel {
  None = 0,
  Fast = 1,
  Normal = 6,
  Maximum = 9,
}

export enum EncryptionType {
  None = 'none',
  AES256 = 'aes256',
}

export enum DestinationType {
  Local = 'local',
  ExternalDrive = 'external_drive',
  NetworkFolder = 'network_folder',
  OneDrive = 'onedrive',
  GoogleDrive = 'google_drive',
  Dropbox = 'dropbox',
  S3 = 's3',
  Azure = 'azure',
  FTP = 'ftp',
  SFTP = 'sftp',
}

export enum RetentionMode {
  KeepLast = 'keep_last',
  KeepByAge = 'keep_by_age',
  Smart = 'smart',
}

export enum InternetBehaviour {
  LocalOnly = 'local_only',
  UploadImmediately = 'upload_immediately',
  UploadWhenInternetReturns = 'upload_when_internet_returns',
}

export enum NotifyOn {
  Completed = 'completed',
  Failed = 'failed',
  StorageAlmostFull = 'storage_almost_full',
  Skipped = 'skipped',
}

export enum NotifyChannel {
  Desktop = 'desktop',
  Email = 'email',
  SMS = 'sms',
  Push = 'push',
}

export enum RestoreScope {
  Database = 'database',
  Files = 'files',
  Config = 'config',
  Everything = 'everything',
}

export type RestoreScopeType = 'database' | 'files' | 'config' | 'everything';

export class RestoreDto {
  @IsEnum(RestoreScope)
  scope!: RestoreScopeType;

  @IsString()
  backupFile!: string;

  @IsOptional() @IsString()
  targetDatabase?: string;

  @IsOptional() @IsBoolean()
  verifyOnly?: boolean;
}

export class RestoreResultDto {
  @IsBoolean()
  success!: boolean;

  @IsString()
  message!: string;

  @IsNumber()
  durationMs!: number;

  @IsOptional() @IsString()
  error?: string;
}

export enum BackupDay {
  Sunday = 0,
  Monday = 1,
  Tuesday = 2,
  Wednesday = 3,
  Thursday = 4,
  Friday = 5,
  Saturday = 6,
  EveryDay = 7,
  Weekdays = 8,
  Weekends = 9,
}

// =============================================================================
// Nested DTOs
// =============================================================================

export class BackupIncludesDto {
  @IsOptional() @IsBoolean() database?: boolean;
  @IsOptional() @IsBoolean() schemaOnly?: boolean;
  @IsOptional() @IsBoolean() databaseData?: boolean;
  @IsOptional() @IsBoolean() uploadedImages?: boolean;
  @IsOptional() @IsBoolean() productImages?: boolean;
  @IsOptional() @IsBoolean() customerDocuments?: boolean;
  @IsOptional() @IsBoolean() generatedReports?: boolean;
  @IsOptional() @IsBoolean() attachments?: boolean;
  @IsOptional() @IsBoolean() envFile?: boolean;
  @IsOptional() @IsBoolean() configFiles?: boolean;
  @IsOptional() @IsBoolean() posSettings?: boolean;
  @IsOptional() @IsBoolean() orgSettings?: boolean;
  @IsOptional() @IsBoolean() printerConfig?: boolean;
  @IsOptional() @IsBoolean() receiptTemplates?: boolean;
  @IsOptional() @IsBoolean() kitchenPrinterSettings?: boolean;
  @IsOptional() @IsBoolean() logs?: boolean;
  @IsOptional() @IsBoolean() auditLogs?: boolean;
  @IsOptional() @IsBoolean() scheduledTasks?: boolean;
}

export class BackupDestinationDto {
  @IsEnum(DestinationType)
  type!: DestinationType;

  @IsString()
  path!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  accessKey?: string;

  @IsOptional()
  @IsString()
  secretKey?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  bucket?: string;
}

export class RetentionPolicyDto {
  @IsEnum(RetentionMode)
  mode!: RetentionMode;

  @IsOptional() @IsNumber() @Min(1) keepLastCount?: number;
  @IsOptional() @IsNumber() @Min(1) keepDays?: number;
  @IsOptional() @IsNumber() @Min(1) smartDaily?: number;
  @IsOptional() @IsNumber() @Min(1) smartWeekly?: number;
  @IsOptional() @IsNumber() @Min(1) smartMonthly?: number;
}

export class NotificationsDto {
  @IsArray()
  @IsEnum(NotifyOn, { each: true })
  on!: NotifyOn[];

  @IsArray()
  @IsEnum(NotifyChannel, { each: true })
  channels!: NotifyChannel[];

  @IsOptional() @IsString() emailAddress?: string;
  @IsOptional() @IsString() phoneNumber?: string;
}

export class VerificationDto {
  @IsOptional() @IsBoolean() verifyIntegrity?: boolean;
  @IsOptional() @IsBoolean() testRestore?: boolean;
  @IsOptional() @IsBoolean() sha256Checksum?: boolean;
}

export class EncryptionDto {
  @IsEnum(EncryptionType)
  type!: EncryptionType;

  @IsOptional() @IsString() password?: string;
}

export class CleanupDto {
  @IsOptional() @IsBoolean() deleteExpired?: boolean;
  @IsOptional() @IsBoolean() deleteTempFiles?: boolean;
  @IsOptional() @IsBoolean() removeFailedFiles?: boolean;
}

export class ScheduleDto {
  @IsOptional() @IsString() time?: string;
  @IsOptional() @IsNumber() dayOfWeek?: number;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsNumber() customIntervalMinutes?: number;
  @IsOptional() @IsString() cronExpression?: string;
}

export class AdvancedDto {
  @IsOptional() @IsNumber() @Min(1) maxThreads?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(9) compressionLevel?: number;
  @IsOptional() @IsBoolean() pauseBusinessHours?: boolean;
  @IsOptional() @IsString() businessHoursStart?: string;
  @IsOptional() @IsString() businessHoursEnd?: string;
  @IsOptional() @IsBoolean() skipIfBusy?: boolean;
  @IsOptional() @IsNumber() @Min(0) retryCount?: number;
  @IsOptional() @IsNumber() @Min(0) retryDelayMinutes?: number;
  @IsOptional() @IsNumber() @Min(0) backupTimeoutMinutes?: number;
  @IsOptional() @IsNumber() @Min(0) maxDiskUsageGb?: number;
  @IsOptional() @IsBoolean() autoDiskSpaceCheck?: boolean;
}

export class DailyFrequencyDto {
  @IsArray()
  @IsString({ each: true })
  times!: string[];
}

export class WeeklyFrequencyDto {
  @IsArray()
  @IsNumber({}, { each: true })
  days!: number[];

  @IsString()
  time!: string;
}

// =============================================================================
// Main config
// =============================================================================

export class BackupConfigDto {
  @IsEnum(BackupFrequency)
  frequency!: BackupFrequency;

  @IsOptional()
  @ValidateNested()
  @Type(() => DailyFrequencyDto)
  dailyConfig?: DailyFrequencyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => WeeklyFrequencyDto)
  weeklyConfig?: WeeklyFrequencyDto;

  @IsOptional()
  @IsString()
  customCronExpression?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  customIntervalMinutes?: number;

  @IsArray()
  @IsEnum(BackupType, { each: true })
  types!: BackupType[];

  @IsOptional()
  @ValidateNested()
  @Type(() => BackupIncludesDto)
  includes?: BackupIncludesDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BackupDestinationDto)
  destinations!: BackupDestinationDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => RetentionPolicyDto)
  retention?: RetentionPolicyDto;

  @IsEnum(CompressionLevel)
  compression!: CompressionLevel;

  @IsOptional()
  @ValidateNested()
  @Type(() => EncryptionDto)
  encryption?: EncryptionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => VerificationDto)
  verification?: VerificationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationsDto)
  notifications?: NotificationsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CleanupDto)
  cleanup?: CleanupDto;

  @IsEnum(InternetBehaviour)
  internetBehaviour!: InternetBehaviour;

  @IsOptional()
  @IsString()
  namingFormat?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScheduleDto)
  schedule?: ScheduleDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdvancedDto)
  advanced?: AdvancedDto;
}

// =============================================================================
// Runtime types (not DTOs)
// =============================================================================

export type BackupKind = 'full' | 'incremental' | 'differential' | 'files' | 'config' | 'cleanup';

export interface BackupRunResult {
  kind: BackupKind;
  status: 'success' | 'failed' | 'skipped';
  target?: string;
  sizeBytes?: number;
  durationMs: number;
  finishedAt: string;
  error?: string;
  checksumSha256?: string;
}
