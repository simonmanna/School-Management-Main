import { IsString } from 'class-validator';

export class MfaEnrollDto {
  /** Optional: when verifying the first TOTP code, the client posts it here. */
  @IsString()
  code!: string;
}