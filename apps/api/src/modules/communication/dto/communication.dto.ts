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
  @ApiProperty({ description: 'internal | whatsapp | telegram' })
  @IsString() @MaxLength(40) providerId!: string;

  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(120) name!: string;

  @ApiProperty({ required: false, description: 'baileys | cloud | bot — defaults per provider' })
  @IsOptional() @IsString() @MaxLength(40) transport?: string;

  @ApiProperty({ required: false, type: Object })
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}

export class DisconnectChannelDto {
  @ApiProperty({ required: false, default: false, description: 'true = full logout (purges the linked-device session).' })
  @IsOptional() @IsBoolean() logout?: boolean;
}
