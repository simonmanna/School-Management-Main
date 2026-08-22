import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';

export interface AvailabilityTree {
  op: '&' | '|' | '!&' | '!|';
  showc?: boolean[];
  c: AvailabilityCondition[];
}
export type AvailabilityCondition = Record<string, unknown> & { type: string };

export interface AvailabilityResult {
  available: boolean;
  /** Human-readable unmet conditions to render when the item is shown greyed. */
  reasons: string[];
  /** true → render greyed with reasons; false → hide entirely. */
  showGreyed: boolean;
}

export interface EvalCtx {
  studentProfileId?: string;
  courseOfferingId: string;
  now?: Date;
}

/**
 * Availability engine (ADR-014 §3.4) — Moodle's restrict-access tree, verbatim shape.
 * Always evaluated server-side. Condition handlers are a registry keyed by `type`,
 * so a new condition is additive.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /** null tree = always available. */
  async evaluate(tree: unknown, ctx: EvalCtx): Promise<AvailabilityResult> {
    if (!tree || typeof tree !== 'object') return { available: true, reasons: [], showGreyed: true };
    const t = tree as AvailabilityTree;
    if (!Array.isArray(t.c) || t.c.length === 0) return { available: true, reasons: [], showGreyed: true };

    const now = ctx.now ?? new Date();
    const results: { met: boolean; reason: string; show: boolean }[] = [];
    for (let i = 0; i < t.c.length; i++) {
      const cond = t.c[i];
      const show = t.showc?.[i] ?? true;
      const { met, reason } = await this.evalCondition(cond, ctx, now);
      results.push({ met, reason, show });
    }

    const mets = results.map((r) => r.met);
    let available: boolean;
    switch (t.op) {
      case '&': available = mets.every(Boolean); break;
      case '|': available = mets.some(Boolean); break;
      case '!&': available = !mets.every(Boolean); break;
      case '!|': available = !mets.some(Boolean); break;
      default: available = mets.every(Boolean);
    }

    const unmet = results.filter((r) => !r.met);
    const reasons = unmet.filter((r) => r.show).map((r) => r.reason);
    // Hide entirely only when every unmet condition is marked hidden (showc=false).
    const showGreyed = unmet.length === 0 || unmet.some((r) => r.show);
    return { available, reasons, showGreyed };
  }

  private async evalCondition(cond: AvailabilityCondition, ctx: EvalCtx, now: Date): Promise<{ met: boolean; reason: string }> {
    switch (cond.type) {
      case 'date': {
        const t = new Date(String(cond.t));
        const dir = String(cond.d ?? '>=');
        const met = dir === '>=' ? now >= t : now < t;
        return { met, reason: dir === '>=' ? `Available from ${t.toLocaleString()}` : `Available until ${t.toLocaleString()}` };
      }
      case 'completion': {
        if (!ctx.studentProfileId) return { met: true, reason: '' };
        const cm = await this.prisma.client.courseModuleCompletion.findFirst({
          where: { organizationId: this.org, courseModuleId: String(cond.cm), studentProfileId: ctx.studentProfileId },
        });
        const want = Number(cond.e ?? 1); // 0 incomplete 1 complete 2 pass 3 fail
        const state = cm?.state ?? 'incomplete';
        const met =
          want === 0 ? state === 'incomplete'
          : want === 1 ? state !== 'incomplete'
          : want === 2 ? state === 'complete_pass'
          : state === 'complete_fail';
        return { met, reason: 'Requires completing a prior activity' };
      }
      case 'grade': {
        if (!ctx.studentProfileId) return { met: true, reason: '' };
        const sa = await this.prisma.client.studentAssessment.findFirst({
          where: { organizationId: this.org, assessmentId: String(cond.assessmentId), studentProfileId: ctx.studentProfileId },
        });
        const score = sa?.percentage != null ? Number(sa.percentage) : sa?.effectiveScore != null ? Number(sa.effectiveScore) : null;
        if (score == null) return { met: false, reason: 'Requires a grade you do not have yet' };
        const min = cond.min != null ? Number(cond.min) : null;
        const max = cond.max != null ? Number(cond.max) : null;
        const met = (min == null || score >= min) && (max == null || score < max);
        return { met, reason: `Requires a grade${min != null ? ` ≥ ${min}` : ''}${max != null ? ` < ${max}` : ''}` };
      }
      case 'group': {
        if (!ctx.studentProfileId) return { met: true, reason: '' };
        const m = await this.prisma.client.lmsGroupMember.findFirst({
          where: { groupId: String(cond.id), studentProfileId: ctx.studentProfileId },
        });
        return { met: !!m, reason: 'Restricted to a group you are not in' };
      }
      case 'grouping': {
        if (!ctx.studentProfileId) return { met: true, reason: '' };
        const grouping = await this.prisma.client.lmsGrouping.findFirst({ where: { id: String(cond.id), organizationId: this.org } });
        if (!grouping) return { met: false, reason: 'Restricted to a grouping' };
        const m = await this.prisma.client.lmsGroupMember.findFirst({
          where: { groupId: { in: grouping.groupIds }, studentProfileId: ctx.studentProfileId },
        });
        return { met: !!m, reason: 'Restricted to a grouping you are not in' };
      }
      case 'profile': {
        if (!ctx.studentProfileId) return { met: true, reason: '' };
        // Best-effort: compare a StudentProfile scalar field.
        const profile = await this.prisma.client.studentProfile.findFirst({
          where: { id: ctx.studentProfileId, organizationId: this.org },
        });
        const field = String(cond.field);
        const actual = profile ? (profile as Record<string, unknown>)[field] : undefined;
        const op = String(cond.op ?? 'isequalto');
        const v = cond.v;
        const met = op === 'isequalto' ? actual === v : op === 'isnotequalto' ? actual !== v : String(actual ?? '').includes(String(v));
        return { met, reason: `Restricted by profile (${field})` };
      }
      case 'role':
        // Role gating is enforced by the capability system; treat as met here.
        return { met: true, reason: '' };
      default:
        return { met: true, reason: '' };
    }
  }
}
