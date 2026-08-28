import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateConversationDto {
  @ApiProperty({ enum: ['direct', 'group', 'channel'], required: false })
  @IsOptional() @IsIn(['direct', 'group', 'channel']) kind?: 'direct' | 'group' | 'channel';

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(200) name?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true }) participantUserIds?: string[];

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(64) contextType?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(64) contextId?: string;

  @ApiProperty({ enum: ['private', 'org', 'role'], required: false })
  @IsOptional() @IsIn(['private', 'org', 'role']) visibility?: 'private' | 'org' | 'role';

  @ApiProperty({ required: false, type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true }) visibleToPermissions?: string[];
}

export class SendMessageDto {
  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(8000) body!: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() replyToMessageId?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsString({ each: true }) targetConversationChannelIds?: string[];
}

export class MarkReadDto {
  @ApiProperty({ required: false })
  @IsOptional() @IsString() messageId?: string;
}

export class ResolveContextDto {
  @ApiProperty()
  @IsString() @MaxLength(64) contextType!: string;

  @ApiProperty()
  @IsString() @MaxLength(64) contextId!: string;
}

export class UpsertTemplateDto {
  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(120) key!: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(120) eventName?: string;

  @ApiProperty({ required: false, description: 'internal | whatsapp | telegram' })
  @IsOptional() @IsString() @MaxLength(40) providerId?: string;

  @ApiProperty({ required: false, default: 'en' })
  @IsOptional() @IsString() @MaxLength(10) locale?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(200) subject?: string;

  @ApiProperty({ description: 'Body with {{dotted.path}} placeholders.' })
  @IsString() @MinLength(1) @MaxLength(8000) body!: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpsertRuleDto {
  @ApiProperty()
  @IsString() @MaxLength(120) eventName!: string;

  @ApiProperty()
  @IsString() @MaxLength(120) templateKey!: string;

  @ApiProperty({ description: 'permission:<perm> | role:<name> | user:<path> | partner:<path>' })
  @IsString() @MaxLength(200) recipientResolver!: string;

  @ApiProperty({ required: false, default: 'internal', description: 'internal | whatsapp | telegram' })
  @IsOptional() @IsString() @MaxLength(40) channelSelector?: string;

  @ApiProperty({ required: false, type: Object, description: 'JSON predicate over the event payload.' })
  @IsOptional() @IsObject() condition?: Record<string, unknown>;

  @ApiProperty({ required: false, default: true })
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class SetEnabledDto {
  @ApiProperty()
  @IsBoolean() enabled!: boolean;
}

export class CreateChannelDto {
  @ApiProperty({ description: 'internal | whatsapp | telegram | sms' })
  @IsString() @MaxLength(40) providerId!: string;

  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(120) name!: string;

  @ApiProperty({ required: false, description: 'baileys | cloud | bot | http — defaults per provider' })
  @IsOptional() @IsString() @MaxLength(40) transport?: string;

  @ApiProperty({ required: false, type: Object })
  @IsOptional() @IsObject() config?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    type: Object,
    description: 'Plaintext gateway credentials, referenced as {{secret.<name>}}. Encrypted at rest; never returned.',
  })
  @IsOptional() @IsObject() secrets?: Record<string, string>;
}

export class UpdateChannelDto {
  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;

  @ApiProperty({ required: false, type: Object })
  @IsOptional() @IsObject() config?: Record<string, unknown>;

  @ApiProperty({ required: false, type: Object, description: 'Omit to keep the stored credentials unchanged.' })
  @IsOptional() @IsObject() secrets?: Record<string, string>;
}

export class SetConsentDto {
  @ApiProperty({ description: 'Raw destination; normalized to E.164 for sms/whatsapp before storing.' })
  @IsString() @MinLength(3) @MaxLength(64) address!: string;

  @ApiProperty({ enum: ['all', 'sms', 'whatsapp', 'telegram', 'internal'], required: false, default: 'all' })
  @IsOptional() @IsIn(['all', 'sms', 'whatsapp', 'telegram', 'internal'])
  channel?: 'all' | 'sms' | 'whatsapp' | 'telegram' | 'internal';

  @ApiProperty({ enum: ['opted_in', 'opted_out'] })
  @IsIn(['opted_in', 'opted_out']) status!: 'opted_in' | 'opted_out';

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(300) reason?: string;

  @ApiProperty({ required: false, description: 'contact | partner | user | student_guardian' })
  @IsOptional() @IsString() @MaxLength(40) subjectType?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(64) subjectId?: string;
}

export class PreviewSmsDto {
  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(8000) body!: string;

  @ApiProperty({ required: false, description: 'Apply the channel transliteration rules before counting.' })
  @IsOptional() @IsBoolean() transliterate?: boolean;
}

export class DisconnectChannelDto {
  @ApiProperty({ required: false, default: false, description: 'true = full logout (purges the linked-device session).' })
  @IsOptional() @IsBoolean() logout?: boolean;
}

/* ── Broadcasts ─────────────────────────────────────────────────────────── */

export class AudienceSelectorDto {
  @ApiProperty({ description: 'all | class | grade | section | stream | campus | house | residence | students | staff | department' })
  @IsString() @MaxLength(24) scope!: string;

  @ApiProperty({ required: false, type: [String], description: 'Class/grade/... ids, or literal house / residence values.' })
  @IsOptional() @IsArray() @IsString({ each: true }) ids?: string[];

  @ApiProperty({ required: false, enum: ['guardians', 'students', 'both'], default: 'guardians' })
  @IsOptional() @IsIn(['guardians', 'students', 'both']) recipients?: 'guardians' | 'students' | 'both';

  @ApiProperty({ required: false, default: true, description: 'One message per family rather than one per guardian on file.' })
  @IsOptional() @IsBoolean() primaryGuardianOnly?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional() @IsBoolean() statementRecipientsOnly?: boolean;

  @ApiProperty({ required: false, type: [String], default: ['active'] })
  @IsOptional() @IsArray() @IsString({ each: true }) studentStatus?: string[];

  @ApiProperty({ required: false, type: [String], description: 'teaching | non_teaching | admin | support' })
  @IsOptional() @IsArray() @IsString({ each: true }) staffCategory?: string[];

  @ApiProperty({
    required: false,
    enum: ['per_recipient', 'per_student'],
    default: 'per_recipient',
    description: 'per_student sends one message per child, so {{student.name}} means something.',
  })
  @IsOptional() @IsIn(['per_recipient', 'per_student']) dedupe?: 'per_recipient' | 'per_student';
}

export class PreviewAudienceDto {
  @ApiProperty({ type: AudienceSelectorDto })
  @IsObject() audience!: Record<string, unknown>;

  @ApiProperty({ required: false, description: 'Counted for the segment/cost estimate.' })
  @IsOptional() @IsString() @MaxLength(8000) body?: string;

  @ApiProperty({ required: false, type: Object, description: 'ChannelPolicy, or a shorthand array like ["whatsapp","sms"].' })
  @IsOptional() channelPolicy?: unknown;
}

export class CreateBroadcastDto {
  @ApiProperty({ required: false, description: 'Operator-facing label. Never sent to recipients.' })
  @IsOptional() @IsString() @MaxLength(200) title?: string;

  @ApiProperty({ description: 'Body, with {{student.name}} / {{recipient.name}} placeholders.' })
  @IsString() @MinLength(1) @MaxLength(8000) body!: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(120) templateKey?: string;

  @ApiProperty({ type: AudienceSelectorDto })
  @IsObject() audience!: Record<string, unknown>;

  @ApiProperty({ required: false, type: Object, description: 'Ordered transports with fallback. Defaults to WhatsApp → SMS → in-app.' })
  @IsOptional() channelPolicy?: unknown;

  @ApiProperty({ required: false, description: 'ISO timestamp. Omit to send as soon as it is submitted.' })
  @IsOptional() @IsString() scheduledAt?: string;
}

export class UpdateBroadcastDto {
  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(200) title?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(8000) body?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(120) templateKey?: string;

  @ApiProperty({ required: false, type: AudienceSelectorDto })
  @IsOptional() @IsObject() audience?: Record<string, unknown>;

  @ApiProperty({ required: false, type: Object })
  @IsOptional() channelPolicy?: unknown;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() scheduledAt?: string;
}

export class SubmitBroadcastDto {
  @ApiProperty({ required: false, description: 'Overrides the stored schedule. Omit to send now.' })
  @IsOptional() @IsString() scheduledAt?: string;
}

export class CancelBroadcastDto {
  @ApiProperty({ required: false, description: 'Recorded on every stopped recipient row and in the audit log.' })
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
