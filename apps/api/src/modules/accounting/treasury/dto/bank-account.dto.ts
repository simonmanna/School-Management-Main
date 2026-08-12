import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateBankAccountDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBankAccountDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  currencyId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TransferDto {
  @IsString()
  @IsNotEmpty()
  fromAccountId!: string;

  @IsString()
  @IsNotEmpty()
  toAccountId!: string;

  @IsNotEmpty()
  amount!: number;

  @IsString()
  @IsNotEmpty()
  date!: string;

  @IsOptional()
  @IsString()
  reference?: string;
}
