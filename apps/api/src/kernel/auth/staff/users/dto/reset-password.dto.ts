import { IsString, Length, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(10, { message: 'new password must be at least 10 characters' })
  @Length(0, 128)
  newPassword!: string;
}
