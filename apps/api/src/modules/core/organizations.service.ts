import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { OneTimeTokenService } from '../../kernel/auth/one-time-token.service';
import { EventBus } from '../../kernel/events/event-bus';
import { AuditService } from '../../kernel/audit/audit.service';
import { NotificationsService } from '../../kernel/notifications/notifications.service';
import { FeatureFlagsService } from '../../kernel/feature-flags/feature-flags.service';
import { seedUomCategories } from './product/uom-seed';
import {
  ACCOUNTING_BOOTSTRAP,
  type AccountingBootstrap,
} from '../../kernel/common/org-bootstrap.tokens';

/**
 * F.5 — Tenant self-service.
 *
 * A super-admin (no tenant context) can create a new Organization and a
 * bootstrap admin user via `bootstrap()`. The new admin receives an invite
 * token they redeem at `/auth/accept-invite`. Subsequent tenant-internal
 * operations stay inside the new tenant context.
 *
 * This unblocks paying customers who today cannot create an org without
 * running `prisma db seed`.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly tokens: OneTimeTokenService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly flags: FeatureFlagsService,
    @Optional()
    @Inject(ACCOUNTING_BOOTSTRAP)
    private readonly accountingBootstrap?: AccountingBootstrap,
  ) {}

  /**
   * Public bootstrap: create a new tenant + bootstrap admin user. In a true
   * multi-tenant SaaS this is gated behind billing. For now, it is the
   * documented entry point for the demo.
   */
  async bootstrap(params: {
    organizationCode: string;
    organizationName: string;
    timezone?: string;
    currencyCode?: string;
    adminEmail: string;
    adminFirstName: string;
    adminLastName?: string;
    adminPassword?: string; // optional; if absent, an invite token is emailed
  }) {
    if (!/^[a-z0-9-]{2,32}$/i.test(params.organizationCode)) {
      throw new BadRequestException('organizationCode must be 2-32 chars, letters/digits/hyphens');
    }
    const existing = await this.prisma.raw.organization.findUnique({ where: { code: params.organizationCode } });
    if (existing) throw new ConflictException(`Organization '${params.organizationCode}' already exists`);

    const passwordHash = params.adminPassword
      ? await bcrypt.hash(params.adminPassword, 10)
      : await bcrypt.hash(randomPassword(), 10);

    const org = await this.prisma.raw.organization.create({
      data: {
        code: params.organizationCode,
        name: params.organizationName,
        currencyCode: params.currencyCode ?? 'USD',
        timezone: params.timezone ?? 'UTC',
      },
    });

    // Seed the accounting core (categories, chart of accounts incl. hierarchy,
    // journals, and ALL account-determination mappings) from the shared template.
    // Injected through a kernel token because core may not import accounting.
    if (this.accountingBootstrap) {
      await this.accountingBootstrap.seedOrganization(org.id);
    }
    await this.seedAdminRoleAndMappings(org.id);
    await this.seedPostingRules(org.id);

    // Create the admin user (no tenant context yet).
    const user = await this.prisma.raw.user.create({
      data: {
        organizationId: org.id,
        email: params.adminEmail.toLowerCase(),
        passwordHash,
        firstName: params.adminFirstName,
        lastName: params.adminLastName ?? null,
      },
    });
    const adminRole = await this.prisma.raw.role.findUnique({
      where: { organizationId_name: { organizationId: org.id, name: 'Administrator' } },
    });
    if (adminRole) {
      await this.prisma.raw.user.update({
        where: { id: user.id },
        data: { roles: { connect: [{ id: adminRole.id }] } },
      });
    }
    // Open the current fiscal period.
    const year = new Date().getUTCFullYear();
    await this.prisma.raw.fiscalPeriod.create({
      data: {
        organizationId: org.id,
        name: `FY${year}`,
        startDate: new Date(Date.UTC(year, 0, 1)),
        endDate: new Date(Date.UTC(year, 11, 31)),
        status: 'open',
      },
    });

    let inviteToken: string | undefined;
    if (!params.adminPassword) {
      inviteToken = await this.tokens.issue({
        purpose: 'invite',
        userId: user.id,
        organizationId: org.id,
      });
      await this.notifications.send({
        organizationId: org.id,
        userId: user.id,
        channel: 'email',
        category: 'auth',
        title: 'You have been invited to ' + params.organizationName,
        body: 'Use the link in this email to set your password and sign in.',
        payload: { token: inviteToken, kind: 'invite' },
      });
    }

    return {
      organization: { id: org.id, code: org.code, name: org.name },
      adminUser: { id: user.id, email: user.email },
      inviteToken,
    };
  }

  /** Accept an invite token + set password. */
  async acceptInvite(token: string, newPassword: string) {
    const consumed = await this.tokens.consume(token, 'invite');
    if (!consumed) throw new BadRequestException('Invalid or expired invite token');
    const hash = await bcrypt.hash(newPassword, 10);
    await this.prisma.raw.user.update({
      where: { id: consumed.userId },
      data: { passwordHash: hash, isActive: true, failedLoginCount: 0, lockedUntil: null },
    });
    return { ok: true };
  }

  /** Update organization-level settings (current user must be admin). */
  async updateSettings(patch: { name?: string; timezone?: string; currencyCode?: string; settings?: Record<string, unknown> }) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.organization.update({
      where: { id: orgId },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(patch.currencyCode !== undefined ? { currencyCode: patch.currencyCode } : {}),
        ...(patch.settings !== undefined ? { settings: patch.settings as any } : {}),
      },
    });
  }

  /** Invite a new user to the current organization. */
  async inviteUser(params: { email: string; firstName: string; lastName?: string; roleId?: string }) {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.raw.user.findUnique({
      where: { organizationId_email: { organizationId: orgId, email: params.email.toLowerCase() } },
    });
    if (existing) throw new ConflictException('A user with this email already exists in your organization');
    const passwordHash = await bcrypt.hash(randomPassword(), 10);
    const user = await this.prisma.raw.user.create({
      data: {
        organizationId: orgId,
        email: params.email.toLowerCase(),
        passwordHash,
        firstName: params.firstName,
        lastName: params.lastName ?? null,
        ...(params.roleId ? { roles: { connect: [{ id: params.roleId }] } } : {}),
      },
    });
    const token = await this.tokens.issue({ purpose: 'invite', userId: user.id, organizationId: orgId });
    await this.notifications.send({
      organizationId: orgId,
      userId: user.id,
      channel: 'email',
      category: 'auth',
      title: 'You have been invited',
      body: 'Click the link to set your password.',
      payload: { token, kind: 'invite' },
    });
    return { id: user.id, email: user.email, inviteToken: token };
  }

  private async seedAdminRoleAndMappings(orgId: string) {
    // Seed permissions catalog (global).
    const { ALL_PERMISSIONS } = await import('@erp/shared');
    for (const k of ALL_PERMISSIONS) {
      // Most keys are `resource:action`, but the POS block uses `resource.action`
      // (e.g. 'partners.view'). Splitting on ':' alone left `action` undefined and
      // Prisma rejected the upsert, which made org bootstrap fail outright.
      const separator = k.includes(':') ? ':' : '.';
      const idx = k.lastIndexOf(separator);
      const resource = idx >= 0 ? k.slice(0, idx) : k;
      const action = idx >= 0 ? k.slice(idx + 1) : k;
      await this.prisma.raw.permission.upsert({
        where: { key: k },
        update: { resource, action },
        create: { key: k, resource, action },
      });
    }
    // Seed currencies (global).
    const currencies = [
      { code: 'USD', symbol: '$', name: 'US Dollar', decimalPlaces: 2 },
      { code: 'EUR', symbol: '€', name: 'Euro', decimalPlaces: 2 },
      { code: 'GBP', symbol: '£', name: 'British Pound', decimalPlaces: 2 },
      { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
      { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', decimalPlaces: 2 },
      { code: 'INR', symbol: '₹', name: 'Indian Rupee', decimalPlaces: 2 },
    ];
    for (const c of currencies) {
      await this.prisma.raw.currency.upsert({ where: { code: c.code }, update: c, create: c });
    }
    // Create the admin role with all permissions.
    await this.prisma.raw.role.create({
      data: {
        organizationId: orgId,
        name: 'Administrator',
        description: 'Full platform access',
        isSystem: true,
        permissions: ALL_PERMISSIONS as unknown as string[],
      },
    });
    // Seed UOM categories + units (factor engine) and tax defaults.
    await seedUomCategories(this.prisma.raw, orgId);
    await this.prisma.raw.tax.create({
      data: { organizationId: orgId, name: 'No Tax', code: 'NONE', type: 'vat', rate: 0 },
    });
    // Seed branch.
    await this.prisma.raw.branch.create({
      data: { organizationId: orgId, code: 'MAIN', name: 'Head Office' },
    });
  }

  /** Seed default inventory posting rules for a new org.
   *
   * Each movement type gets lines that mirror the original hardcoded
   * Dr/Cr structure, resolved via AccountMapping keys. Users can override
   * these lines later, add product-level overrides, or change accountSource
   * to `literal`/`category_field`/`product_field`.
   */
  private async seedPostingRules(orgId: string) {
    const rules: Array<{
      movementType: string;
      lineIndex: number;
      debitOrCredit: string;
      accountSource: string;
      accountMappingKey: string;
    }> = [
      // STOCK_IN (e.g. purchase receipt) → Dr Stock Valuation / Cr GRNI
      { movementType: 'STOCK_IN', lineIndex: 0, debitOrCredit: 'debit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      { movementType: 'STOCK_IN', lineIndex: 1, debitOrCredit: 'credit', accountSource: 'account_mapping', accountMappingKey: 'grni_accrued' },
      // STOCK_OUT (e.g. sale/issue) → Dr COGS / Cr Stock Valuation
      { movementType: 'STOCK_OUT', lineIndex: 0, debitOrCredit: 'debit', accountSource: 'account_mapping', accountMappingKey: 'cogs' },
      { movementType: 'STOCK_OUT', lineIndex: 1, debitOrCredit: 'credit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      // RETURN_RESTOCK (customer return) → Dr Stock Valuation / Cr COGS
      { movementType: 'RETURN_RESTOCK', lineIndex: 0, debitOrCredit: 'debit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      { movementType: 'RETURN_RESTOCK', lineIndex: 1, debitOrCredit: 'credit', accountSource: 'account_mapping', accountMappingKey: 'cogs' },
      // ADJUSTMENT_GAIN (positive count diff) → Dr Stock Valuation / Cr Adj Income
      { movementType: 'ADJUSTMENT_GAIN', lineIndex: 0, debitOrCredit: 'debit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      { movementType: 'ADJUSTMENT_GAIN', lineIndex: 1, debitOrCredit: 'credit', accountSource: 'account_mapping', accountMappingKey: 'stock_adjustment_income' },
      // ADJUSTMENT_LOSS (negative count diff) → Dr Adj Expense / Cr Stock Valuation
      { movementType: 'ADJUSTMENT_LOSS', lineIndex: 0, debitOrCredit: 'debit', accountSource: 'account_mapping', accountMappingKey: 'stock_adjustment_expense' },
      { movementType: 'ADJUSTMENT_LOSS', lineIndex: 1, debitOrCredit: 'credit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      // WASTE → Dr Adj Expense / Cr Stock Valuation
      { movementType: 'WASTE', lineIndex: 0, debitOrCredit: 'debit', accountSource: 'account_mapping', accountMappingKey: 'stock_adjustment_expense' },
      { movementType: 'WASTE', lineIndex: 1, debitOrCredit: 'credit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      // EXPIRY_WRITE_OFF → Dr Expiry / Cr Stock Valuation (uses category_field fallback)
      { movementType: 'EXPIRY_WRITE_OFF', lineIndex: 0, debitOrCredit: 'debit', accountSource: 'category_field', accountMappingKey: 'stock_adjustment_expense' },
      { movementType: 'EXPIRY_WRITE_OFF', lineIndex: 1, debitOrCredit: 'credit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      // INTERNAL_CONSUMPTION → Dr Internal Use / Cr Stock Valuation (uses category_field fallback)
      { movementType: 'INTERNAL_CONSUMPTION', lineIndex: 0, debitOrCredit: 'debit', accountSource: 'category_field', accountMappingKey: 'stock_adjustment_expense' },
      { movementType: 'INTERNAL_CONSUMPTION', lineIndex: 1, debitOrCredit: 'credit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      // PROMO_SAMPLE → Dr Promo Expense / Cr Stock Valuation (uses category_field fallback)
      { movementType: 'PROMO_SAMPLE', lineIndex: 0, debitOrCredit: 'debit', accountSource: 'category_field', accountMappingKey: 'stock_adjustment_expense' },
      { movementType: 'PROMO_SAMPLE', lineIndex: 1, debitOrCredit: 'credit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      // STOCK_TRANSFER → No GL (skip) — seeded with empty flag for completeness
      { movementType: 'STOCK_TRANSFER_OUT', lineIndex: 0, debitOrCredit: 'debit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      { movementType: 'STOCK_TRANSFER_OUT', lineIndex: 1, debitOrCredit: 'credit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      { movementType: 'STOCK_TRANSFER_IN', lineIndex: 0, debitOrCredit: 'debit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      { movementType: 'STOCK_TRANSFER_IN', lineIndex: 1, debitOrCredit: 'credit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      // RETURN_TO_SUPPLIER → Dr GRNI / Cr Stock Valuation
      { movementType: 'RETURN_TO_SUPPLIER', lineIndex: 0, debitOrCredit: 'debit', accountSource: 'account_mapping', accountMappingKey: 'grni_accrued' },
      { movementType: 'RETURN_TO_SUPPLIER', lineIndex: 1, debitOrCredit: 'credit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      // PRODUCTION_CONSUME → Dr WIP / Cr Stock Valuation
      { movementType: 'PRODUCTION_CONSUME', lineIndex: 0, debitOrCredit: 'debit', accountSource: 'account_mapping', accountMappingKey: 'wip' },
      { movementType: 'PRODUCTION_CONSUME', lineIndex: 1, debitOrCredit: 'credit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      // PRODUCTION_OUTPUT → Dr Stock Valuation / Cr WIP
      { movementType: 'PRODUCTION_OUTPUT', lineIndex: 0, debitOrCredit: 'debit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      { movementType: 'PRODUCTION_OUTPUT', lineIndex: 1, debitOrCredit: 'credit', accountSource: 'account_mapping', accountMappingKey: 'wip' },
      // REVALUATION → Dr/Cr Stock Valuation / Dr/Cr Revaluation Surplus
      { movementType: 'REVALUATION', lineIndex: 0, debitOrCredit: 'debit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
      { movementType: 'REVALUATION', lineIndex: 1, debitOrCredit: 'credit', accountSource: 'account_mapping', accountMappingKey: 'stock_valuation' },
    ];

    for (const r of rules) {
      await this.prisma.raw.inventoryPostingRule.create({
        data: {
          organizationId: orgId,
          movementType: r.movementType as any,
          lineIndex: r.lineIndex,
          debitOrCredit: r.debitOrCredit,
          accountSource: r.accountSource,
          accountMappingKey: r.accountMappingKey,
        },
      });
    }
  }
}

function randomPassword(): string {
  // 24 chars base64url — meets the password policy by accident (length > 8,
  // includes letters/digits/symbols when used as a one-time secret).
  return require('crypto').randomBytes(18).toString('base64url');
}
