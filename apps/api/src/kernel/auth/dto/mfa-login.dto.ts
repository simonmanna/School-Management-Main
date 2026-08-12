import { IsString } from 'class-validator';

export class MfaLoginDto {
  @IsString()
  mfaToken!: string;

  @IsString()
  code!: string;
}