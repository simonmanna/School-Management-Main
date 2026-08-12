import { Body, Controller, Get, NotFoundException, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { SettingsService } from './settings.service';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';

// ── DTOs ─────────────────────────────────────────────────────────────────────

class CompanySettingsDto {
  @IsOptional() @IsString() incomeAccountId?: string;
  @IsOptional() @IsString() expenseAccountId?: string;
  @IsOptional() @IsString() defaultSalesTaxId?: string;
  @IsOptional() @IsString() exchangeDifferenceJournalId?: string;
  @IsOptional() @IsString() defaultSalesJournalId?: string;
  @IsOptional() @IsString() exchangeGainAccountId?: string;
  @IsOptional() @IsString() exchangeLossAccountId?: string;
  @IsOptional() @IsString() productIncomeAccountId?: string;
  @IsOptional() @IsString() productExpenseAccountId?: string;
  @IsOptional() @IsString() costingMethod?: string;
  @IsOptional() @IsString() baseCurrencyCode?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) allCurrencyCodes?: string[];
  @IsOptional() fiscalYearStartMonth?: number;
}

class DeveloperSettingsDto {
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() features?: Record<string, boolean>;
}

// ── Controller ───────────────────────────────────────────────────────────────

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class CompanySettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * GET /settings/company — return all company (accounting) settings with
   * reference data (accounts, journals, taxes, currencies) for select dropdowns.
   */
  @Get('company')
  @RequirePermissions(PERMISSIONS.setting.read)
  async getCompanySettings() {
    const orgId = this.tenant.organizationId;

    // Fetch all accounting-group effective values. Deprecated keys are included
    // here so this legacy read-through response keeps its shape for existing
    // clients; the admin UI uses /settings/effective, which omits them.
    const effective = await this.settings.listEffective('accounting', {}, { includeDeprecated: true });
    const byKey: Record<string, unknown> = {};
    for (const s of effective) {
      byKey[s.key] = s.value;
    }

    // Fetch costing method from inventory defaults
    const invDefaults = await this.settings.getInventoryDefaults();

    // Fetch org details (base currency)
    const org = await this.prisma.raw.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    // Reference data for selects
    const [accounts, journals, taxes, currencies] = await Promise.all([
      this.prisma.raw.account.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, code: true, name: true, reportSection: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.raw.journal.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.raw.tax.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, name: true, code: true, rate: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.raw.currency.findMany({
        where: { isActive: true },
        select: { code: true, name: true, symbol: true },
        orderBy: { code: 'asc' },
      }),
    ]);

    return {
      incomeAccountId: byKey['accounting.incomeAccountId'] || null,
      expenseAccountId: byKey['accounting.expenseAccountId'] || null,
      defaultSalesTaxId: byKey['accounting.defaultSalesTaxId'] || null,
      exchangeDifferenceJournalId: byKey['accounting.exchangeDifferenceJournalId'] || null,
      defaultSalesJournalId: byKey['accounting.defaultSalesJournalId'] || null,
      exchangeGainAccountId: byKey['accounting.exchangeGainAccountId'] || null,
      exchangeLossAccountId: byKey['accounting.exchangeLossAccountId'] || null,
      productIncomeAccountId: byKey['accounting.productIncomeAccountId'] || null,
      productExpenseAccountId: byKey['accounting.productExpenseAccountId'] || null,
      allCurrencyCodes: byKey['accounting.allCurrencyCodes'] || [],
      costingMethod: invDefaults.costingMethod,
      baseCurrencyCode: org.currencyCode,
      fiscalYearStartMonth: byKey['accounting.fiscalYearStartMonth'] ?? 1,
      // Reference data
      _references: { accounts, journals, taxes, currencies },
    };
  }

  /**
   * PUT /settings/company — save company settings.
   */
  @Put('company')
  @RequirePermissions(PERMISSIONS.setting.update)
  async putCompanySettings(@Body() dto: CompanySettingsDto) {
    const orgId = this.tenant.organizationId;

    // Persist each setting via the SettingsService (validates + coerces)
    const accountingKeys: Array<{ dtoKey: string; settingKey: string }> = [
      { dtoKey: 'incomeAccountId', settingKey: 'accounting.incomeAccountId' },
      { dtoKey: 'expenseAccountId', settingKey: 'accounting.expenseAccountId' },
      { dtoKey: 'defaultSalesTaxId', settingKey: 'accounting.defaultSalesTaxId' },
      { dtoKey: 'exchangeDifferenceJournalId', settingKey: 'accounting.exchangeDifferenceJournalId' },
      { dtoKey: 'defaultSalesJournalId', settingKey: 'accounting.defaultSalesJournalId' },
      { dtoKey: 'exchangeGainAccountId', settingKey: 'accounting.exchangeGainAccountId' },
      { dtoKey: 'exchangeLossAccountId', settingKey: 'accounting.exchangeLossAccountId' },
      { dtoKey: 'productIncomeAccountId', settingKey: 'accounting.productIncomeAccountId' },
      { dtoKey: 'productExpenseAccountId', settingKey: 'accounting.productExpenseAccountId' },
      { dtoKey: 'fiscalYearStartMonth', settingKey: 'accounting.fiscalYearStartMonth' },
      { dtoKey: 'allCurrencyCodes', settingKey: 'accounting.allCurrencyCodes' },
    ];

    for (const { dtoKey, settingKey } of accountingKeys) {
      const value = (dto as any)[dtoKey];
      if (value !== undefined) {
        await this.settings.set(settingKey, value);
      }
    }

    // Update costing method via inventory defaults
    if (dto.costingMethod !== undefined) {
      await this.settings.set('inventory.defaultCostingMethod', dto.costingMethod);
    }

    // Update base currency on the Organization record
    if (dto.baseCurrencyCode !== undefined) {
      await this.prisma.raw.organization.update({
        where: { id: orgId },
        data: { currencyCode: dto.baseCurrencyCode },
      });
    }

    return this.getCompanySettings();
  }

  /**
   * GET /settings/developer — return developer-level org settings.
   */
  @Get('developer')
  @RequirePermissions(PERMISSIONS.setting.read)
  async getDeveloperSettings() {
    const orgId = this.tenant.organizationId;
    const org = await this.prisma.raw.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    const settings = (org.settings as Record<string, unknown>) || {};
    const features = (settings.features as Record<string, boolean>) || {};

    return {
      logoUrl: (settings.logoUrl as string) || null,
      name: org.name,
      features,
    };
  }

  /**
   * PUT /settings/developer — save developer settings.
   */
  @Put('developer')
  @RequirePermissions(PERMISSIONS.setting.update)
  async putDeveloperSettings(@Body() dto: DeveloperSettingsDto) {
    const orgId = this.tenant.organizationId;
    const org = await this.prisma.raw.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    const currentSettings = (org.settings as Record<string, unknown>) || {};

    const updateData: Record<string, unknown> = {};

    if (dto.name !== undefined) {
      updateData.name = dto.name;
    }

    if (dto.logoUrl !== undefined || dto.features !== undefined) {
      const newSettings = { ...currentSettings };
      if (dto.logoUrl !== undefined) {
        newSettings.logoUrl = dto.logoUrl;
      }
      if (dto.features !== undefined) {
        newSettings.features = dto.features;
      }
      updateData.settings = newSettings as any;
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.raw.organization.update({
        where: { id: orgId },
        data: updateData,
      });
    }

    return this.getDeveloperSettings();
  }
}
