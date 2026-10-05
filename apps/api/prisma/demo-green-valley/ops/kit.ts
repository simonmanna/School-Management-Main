/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Plumbing for the operations stages: the seed clock, the context every stage
 * receives, and the timeline that replays a school year in date order.
 */
import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS } from '@erp/shared';
import type { School } from '../shared';
import { SCHOOL, warn } from '../shared';

/* ───────────────────────────── The seed clock ─────────────────────────────── */

/**
 * The services stamp "now" on everything they write — invoice issue dates,
 * journal posting dates, receipt numbers' years. A demo whose every Term 1
 * invoice is dated today reads as fabricated, so the seed moves the process
 * clock to the business date before each call.
 *
 * `Date` is replaced by a constructor that shares the real prototype: values it
 * builds ARE real Dates (so `instanceof Date` holds everywhere, including inside
 * Prisma), and only the no-argument form and `Date.now()` are shifted. Timers
 * are untouched — this moves the calendar, not the event loop.
 *
 * Column defaults computed by the database engine (`@default(now())`) still
 * carry the real time; stages that display `createdAt` re-stamp it afterwards.
 */
const RealDate = Date;
let offsetMs = 0;

export const clock = {
  install(): void {
    if ((globalThis.Date as unknown) !== RealDate) return;
    function SeedDate(this: unknown, ...args: unknown[]) {
      if (!new.target) return new RealDate(RealDate.now() + offsetMs).toString();
      if (args.length === 0) return new RealDate(RealDate.now() + offsetMs);
      return new (RealDate as unknown as new (...a: unknown[]) => Date)(...args);
    }
    SeedDate.prototype = RealDate.prototype;
    SeedDate.now = () => RealDate.now() + offsetMs;
    SeedDate.parse = RealDate.parse;
    SeedDate.UTC = RealDate.UTC;
    (globalThis as { Date: unknown }).Date = SeedDate;
  },
  /** Make "now" read as `at`; the clock keeps ticking from there. */
  set(at: Date): void {
    offsetMs = at.getTime() - RealDate.now();
  },
  reset(): void {
    offsetMs = 0;
  },
  realNow(): Date {
    return new RealDate(RealDate.now());
  },
};

/* ─────────────────────────────── Dates ────────────────────────────────────── */

/** A Kampala (UTC+3) wall-clock time on a date, as an instant. */
export function eat(isoDate: string, hhmm = '10:00'): Date {
  return new Date(`${isoDate}T${hhmm}:00+03:00`);
}

export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(isoDate: string, n: number): string {
  return iso(new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + n * 86_400_000));
}

/** Monday–Friday dates between two ISO dates, inclusive. */
export function weekdays(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  for (let d = fromIso; d <= toIso; d = addDaysIso(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5) out.push(d);
  }
  return out;
}

/** Uganda public holidays falling in the 2026 school year. */
export const PUBLIC_HOLIDAYS_2026: Array<{ date: string; name: string }> = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-26', name: 'NRM Liberation Day' },
  { date: '2026-02-16', name: 'Archbishop Janani Luwum Day' },
  { date: '2026-03-08', name: "International Women's Day" },
  { date: '2026-03-20', name: 'Eid al-Fitr' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-06', name: 'Easter Monday' },
  { date: '2026-05-01', name: 'Labour Day' },
  { date: '2026-05-27', name: 'Eid al-Adha' },
  { date: '2026-06-03', name: "Uganda Martyrs' Day" },
  { date: '2026-06-09', name: "National Heroes' Day" },
  { date: '2026-10-09', name: 'Independence Day' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2026-12-26', name: 'Boxing Day' },
];
const HOLIDAY_SET = new Set(PUBLIC_HOLIDAYS_2026.map((h) => h.date));

/** School days: weekdays that are not public holidays. */
export function schoolDaysIso(fromIso: string, toIso: string): string[] {
  return weekdays(fromIso, toIso).filter((d) => !HOLIDAY_SET.has(d));
}

/* ───────────────────────────── The context ────────────────────────────────── */

export interface OpsHost {
  service<T = any>(relPath: string, exportName: string): T;
  distModule(relPath: string): any;
}

export type Persona = 'head' | 'deputy' | 'bursar' | 'registrar' | 'dos' | 'accounts' | 'hr' | 'transport' | 'kitchen';

export interface Ctx {
  host: OpsHost;
  prisma: PrismaClient;
  school: School;
  O: string;
  /** Last date the demo story reaches (yesterday, at most the end of 2026). */
  asOf: string;
  users: Record<Persona, string>;
  /** Run `fn` as a member of staff, inside the tenant context the services need. */
  as<T = any>(who: Persona, fn: () => Promise<T>): Promise<T>;
  svc<T = any>(relPath: string, exportName: string): T;
}

export async function buildContext(host: OpsHost, prisma: PrismaClient, school: School, asOf: string): Promise<Ctx> {
  const O = school.O;
  const tenant = host.service('kernel/tenancy/tenant-context.service', 'TenantContextService');
  const d = SCHOOL.emailDomain;

  const userId = async (email: string): Promise<string | null> =>
    (await prisma.user.findFirst({ where: { organizationId: O, email }, select: { id: true } }))?.id ?? null;

  const head = await userId(`head@${d}`);
  const bursar = await userId(`bursar@${d}`);
  if (!head || !bursar) {
    throw new Error(`head@${d} / bursar@${d} not found — run the academic demo (db:seed:${SCHOOL.key}-demo) first.`);
  }
  const fallback = (id: string | null, to: string) => id ?? to;
  const users: Record<Persona, string> = {
    head,
    bursar,
    deputy: fallback(await userId(`deputy@${d}`), head),
    registrar: fallback(await userId(`registrar@${d}`), head),
    dos: fallback(await userId(`dos@${d}`), head),
    accounts: fallback(await userId(`accounts@${d}`), bursar),
    hr: fallback(await userId(`hr@${d}`), head),
    transport: fallback(await userId(`transport@${d}`), head),
    kitchen: fallback(await userId(`kitchen@${d}`), bursar),
  };

  const permissions = [...(ALL_PERMISSIONS as readonly string[])];
  const ctx: Ctx = {
    host,
    prisma,
    school,
    O,
    asOf,
    users,
    as: (who, fn) => tenant.run({ organizationId: O, userId: ctx.users[who], permissions }, fn),
    svc: (relPath, exportName) => host.service(relPath, exportName),
  };
  return ctx;
}

/* ───────────────────────────── The timeline ───────────────────────────────── */

export interface TimelineEvent {
  /** Business instant. Events run in (date, priority) order. */
  at: Date;
  /** Lower runs first within a day: 0 setup, 10 billing, 20 receipts, 30 spending, 40 payroll. */
  priority: number;
  label: string;
  run: () => Promise<unknown>;
}

/**
 * The year, replayed in order. Events sharing a day and a priority are
 * independent by construction (different pupils, different suppliers), so they
 * run a few at a time; the clock is set once per group to that day's morning.
 */
export class Timeline {
  private readonly events: TimelineEvent[] = [];
  readonly failures: Array<{ label: string; error: string }> = [];
  done = 0;

  add(ev: TimelineEvent): void {
    this.events.push(ev);
  }

  get size(): number {
    return this.events.length;
  }

  async run(opts: { asOf: string; concurrency?: number; log?: (m: string) => void }): Promise<void> {
    const limit = opts.concurrency ?? 6;
    const cutoff = new Date(`${opts.asOf}T23:59:59+03:00`).getTime();
    const events = this.events
      .filter((e) => e.at.getTime() <= cutoff)
      .sort((a, b) => a.at.getTime() - b.at.getTime() || a.priority - b.priority);

    const groups = new Map<string, TimelineEvent[]>();
    for (const e of events) {
      const key = `${iso(new Date(e.at.getTime() + 3 * 3_600_000))}#${String(e.priority).padStart(3, '0')}`;
      const list = groups.get(key) ?? [];
      list.push(e);
      groups.set(key, list);
    }

    let lastMonth = '';
    for (const [key, list] of groups) {
      const day = key.slice(0, 10);
      if (day.slice(0, 7) !== lastMonth) {
        lastMonth = day.slice(0, 7);
        opts.log?.(`${lastMonth}: replaying (${this.done}/${events.length} events done)`);
      }
      clock.set(list[0].at);
      await pool(list, limit, async (e) => {
        try {
          await e.run();
        } catch (err: any) {
          const lines = String(err?.message ?? err).split('\n').map((l) => l.trim()).filter(Boolean);
          const error = (lines.length > 1 ? `${lines[0]} … ${lines[lines.length - 1]}` : lines[0] ?? 'unknown').slice(0, 300);
          this.failures.push({ label: e.label, error });
        }
        this.done += 1;
      });
    }
    clock.reset();
  }

  report(): void {
    if (this.failures.length === 0) return;
    warn(`${this.failures.length} timeline event(s) failed:`);
    const byError = new Map<string, string[]>();
    for (const f of this.failures) {
      const list = byError.get(f.error) ?? [];
      list.push(f.label);
      byError.set(f.error, list);
    }
    for (const [error, labels] of byError) {
      console.log(`    ${labels.length}× ${error}`);
      console.log(`       e.g. ${labels.slice(0, 3).join(' | ')}`);
    }
  }
}

/** Run `fn` over `items`, at most `limit` at a time. */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

/** Round to whole shillings, then to a "price-like" step (default 500). */
export function ugx(amount: number, step = 500): number {
  return Math.max(step, Math.round(amount / step) * step);
}

/** A deterministic MTN / Airtel style transaction id. */
export function momoTxnId(r: () => number, provider: 'MTN' | 'AIRTEL'): string {
  let digits = '';
  for (let i = 0; i < 11; i += 1) digits += String(Math.floor(r() * 10));
  return provider === 'MTN' ? digits : `CI${digits.slice(0, 6)}.${digits.slice(6)}`;
}
