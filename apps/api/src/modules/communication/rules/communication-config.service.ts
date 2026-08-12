import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { TemplateRenderService } from './template-render.service';
import { RULE_EVENTABLE } from '../communication.subscriber';

export interface UpsertTemplateInput {
  key: string;
  eventName?: string;
  providerId?: string;
  locale?: string;
  subject?: string;
  body: string;
  active?: boolean;
}

export interface UpsertRuleInput {
  eventName: string;
  templateKey: string;
  recipientResolver: string;
  channelSelector?: string;
  condition?: Record<string, unknown>;
  enabled?: boolean;
}

/**
 * Admin CRUD for message templates and communication rules. Config, not
 * messaging traffic — so channel-config actions are the only part of this domain
 * that touches the AuditLog (the messages themselves are their own record).
 */
@Injectable()
export class CommunicationConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly templates: TemplateRenderService,
    private readonly audit: AuditService,
  ) {}

  /* ── Templates ─────────────────────────────────────────────────────────── */

  listTemplates() {
    return this.prisma.client.messageTemplate.findMany({ orderBy: [{ key: 'asc' }, { version: 'desc' }] });
  }

  async upsertTemplate(input: UpsertTemplateInput) {
    const orgId = this.tenant.organizationId;
    const variables = this.templates.extractVariables(input.body);
    // Templates are versioned by (key, providerId, locale); a re-save bumps the
    // active version rather than mutating history.
    const locale = input.locale ?? 'en';
    const providerId = input.providerId ?? null;
    const latest = await this.prisma.client.messageTemplate.findFirst({
      where: { key: input.key, providerId, locale },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;
    return this.prisma.client.$transaction(async (tx) => {
      // Deactivate prior versions so exactly one is active per (key, provider, locale).
      await tx.messageTemplate.updateMany({ where: { key: input.key, providerId, locale }, data: { active: false } });
      const created = await tx.messageTemplate.create({
        data: {
          organizationId: orgId,
          key: input.key,
          eventName: input.eventName ?? null,
          providerId,
          locale,
          version,
          subject: input.subject ?? null,
          body: input.body,
          variables,
          active: input.active ?? true,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'MessageTemplate',
        entityId: created.id,
        action: 'create',
        newValues: { key: input.key, version, providerId, locale },
      });
      return created;
    });
  }

  /* ── Rules ─────────────────────────────────────────────────────────────── */

  listRules() {
    return this.prisma.client.communicationRule.findMany({ orderBy: { eventName: 'asc' } });
  }

  /** The events a rule may bind to (fixed catalog). Powers the admin dropdown. */
  eventableEvents(): string[] {
    return [...RULE_EVENTABLE];
  }

  async upsertRule(input: UpsertRuleInput) {
    const orgId = this.tenant.organizationId;
    if (!RULE_EVENTABLE.includes(input.eventName as never)) {
      throw new BadRequestException(
        `Event '${input.eventName}' is not rule-eventable. Allowed: ${RULE_EVENTABLE.join(', ')}`,
      );
    }
    const created = await this.prisma.client.communicationRule.upsert({
      where: {
        organizationId_eventName_templateKey: {
          organizationId: orgId,
          eventName: input.eventName,
          templateKey: input.templateKey,
        },
      },
      update: {
        recipientResolver: input.recipientResolver,
        channelSelector: input.channelSelector ?? 'internal',
        condition: (input.condition ?? {}) as object,
        enabled: input.enabled ?? true,
      },
      create: {
        organizationId: orgId,
        eventName: input.eventName,
        templateKey: input.templateKey,
        recipientResolver: input.recipientResolver,
        channelSelector: input.channelSelector ?? 'internal',
        condition: (input.condition ?? {}) as object,
        enabled: input.enabled ?? true,
      },
    });
    return created;
  }

  async setRuleEnabled(id: string, enabled: boolean) {
    await this.prisma.client.communicationRule.update({ where: { id }, data: { enabled } });
    return { ok: true };
  }

  async deleteRule(id: string) {
    await this.prisma.client.communicationRule.delete({ where: { id } });
    return { ok: true };
  }
}
