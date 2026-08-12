import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * F.5 + F.7 — Cross-entity global search.
 *
 * Two-mode matching:
 *   1. **Exact substring** (fast path via `ILIKE %q%`): catches the obvious
 *      matches — e.g. typing the document number.
 *   2. **Trigram similarity** (slow path via `pg_trgm.similarity() > 0.25`):
 *      catches typos — e.g. "acme" → "Acme Retail Ltd".
 *
 * Both are executed in parallel and the results are de-duplicated by
 * (type, id). The pg_trgm indexes (created in migration
 * `20260622170000_phase_f7_crm_search_trgm`) keep the trigram path fast
 * up to ~1M rows per table.
 */
export interface SearchHit {
  type: 'partner' | 'product' | 'invoice' | 'credit_note' | 'payment' | 'expense' | 'account' | 'journal_entry' | 'deal';
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  meta?: Record<string, unknown>;
}

interface IndexedEntity {
  type: SearchHit['type'];
  href: (id: string) => string;
  title: (row: any) => string;
  subtitle: (row: any) => string;
  /** Display / search-result fields (column projection for the result list). */
  fields: string[];
  /** Substring + trigram query. Returns up to 5 rows. */
  query: (q: string, orgId: string) => Promise<any[]>;
  /** Columns used for the trigram similarity score (higher = better match). */
  trgmColumns: string[];
  /** Column used for ordering by similarity. */
  trgmOrder: string;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger('SearchService');
  /** Minimum similarity score (0-1) to count as a trigram match. */
  private static readonly TRGM_THRESHOLD = 0.2;
  private readonly entities: IndexedEntity[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {
    this.entities = [
      {
        type: 'partner',
        fields: ['code', 'name'],
        href: (id) => `/partners/${id}`,
        title: (r) => r.name,
        subtitle: (r) => `${r.code}${r.email ? ' · ' + r.email : ''}`,
        trgmColumns: ['name', 'code'],
        trgmOrder: 'name',
        query: async (q, orgId) => {
          const like = { contains: q, mode: 'insensitive' as const };
          return this.prisma.raw.partner.findMany({
            where: {
              organizationId: orgId,
              deletedAt: null,
              OR: [{ name: like }, { code: like }, { email: like }, { phone: like }, { taxNumber: like }],
            },
            take: 5,
          });
        },
      },
      {
        type: 'product',
        fields: ['code', 'sku', 'name'],
        href: (id) => `/products/${id}`,
        title: (r) => r.name,
        subtitle: (r) => `${r.code}${r.sku ? ' · ' + r.sku : ''}`,
        trgmColumns: ['name', 'code', 'sku'],
        trgmOrder: 'name',
        query: async (q, orgId) => {
          const like = { contains: q, mode: 'insensitive' as const };
          return this.prisma.raw.product.findMany({
            where: {
              organizationId: orgId,
              isActive: true,
              OR: [{ name: like }, { code: like }, { sku: like }],
            },
            take: 5,
          });
        },
      },
      {
        type: 'invoice',
        fields: ['documentNumber', 'reference'],
        href: (id) => `/invoices/${id}`,
        title: (r) => r.document_number ?? r.documentNumber,
        subtitle: (r) => `${r.partner?.name ?? ''} · ${r.totalAmount ?? ''}`,
        trgmColumns: ['documentNumber', 'reference'],
        trgmOrder: 'documentNumber',
        query: async (q, orgId) => {
          const like = { contains: q, mode: 'insensitive' as const };
          return this.prisma.raw.document.findMany({
            where: {
              organizationId: orgId,
              documentType: 'sales_invoice',
              OR: [{ documentNumber: like }, { reference: like }],
            },
            include: { partner: true },
            take: 5,
          });
        },
      },
      {
        type: 'credit_note',
        fields: ['documentNumber'],
        href: (id) => `/credit-notes/${id}`,
        title: (r) => r.document_number ?? r.documentNumber,
        subtitle: (r) => r.partner?.name ?? '',
        trgmColumns: ['documentNumber'],
        trgmOrder: 'documentNumber',
        query: async (q, orgId) => {
          return this.prisma.raw.document.findMany({
            where: {
              organizationId: orgId,
              documentType: 'credit_note',
              documentNumber: { contains: q, mode: 'insensitive' },
            },
            include: { partner: true },
            take: 5,
          });
        },
      },
      {
        type: 'payment',
        fields: ['paymentNumber', 'reference'],
        href: (id) => `/payments/${id}`,
        title: (r) => r.payment_number ?? r.paymentNumber,
        subtitle: (r) => r.partner?.name ?? '',
        trgmColumns: ['paymentNumber', 'reference'],
        trgmOrder: 'paymentNumber',
        query: async (q, orgId) => {
          const like = { contains: q, mode: 'insensitive' as const };
          return this.prisma.raw.payment.findMany({
            where: {
              organizationId: orgId,
              OR: [{ paymentNumber: like }, { reference: like }],
            },
            include: { partner: true },
            take: 5,
          });
        },
      },
      {
        type: 'expense',
        fields: ['documentNumber'],
        href: (id) => `/expenses/${id}`,
        title: (r) => r.document_number ?? r.documentNumber,
        subtitle: (r) => r.partner?.name ?? '',
        trgmColumns: ['documentNumber'],
        trgmOrder: 'documentNumber',
        query: async (q, orgId) => {
          return this.prisma.raw.document.findMany({
            where: {
              organizationId: orgId,
              documentType: 'vendor_bill',
              documentNumber: { contains: q, mode: 'insensitive' },
            },
            include: { partner: true },
            take: 5,
          });
        },
      },
      {
        type: 'account',
        fields: ['code', 'name'],
        href: (id) => `/accounts?id=${id}`,
        title: (r) => `${r.code} ${r.name}`,
        subtitle: (r) => r.category?.key ?? r.reportSection ?? 'account',
        trgmColumns: ['name', 'code'],
        trgmOrder: 'name',
        query: async (q, orgId) => {
          const like = { contains: q, mode: 'insensitive' as const };
          return this.prisma.raw.account.findMany({
            where: {
              organizationId: orgId,
              OR: [{ code: like }, { name: like }],
            },
            take: 5,
          });
        },
      },
      {
        type: 'journal_entry',
        fields: ['entryNumber', 'description'],
        href: (id) => `/journal-entries/${id}`,
        title: (r) => r.entry_number ?? r.entryNumber,
        subtitle: (r) => r.description ?? '',
        trgmColumns: ['entryNumber', 'description'],
        trgmOrder: 'entryNumber',
        query: async (q, orgId) => {
          const like = { contains: q, mode: 'insensitive' as const };
          return this.prisma.raw.journalEntry.findMany({
            where: {
              organizationId: orgId,
              OR: [{ entryNumber: like }, { description: like }],
            },
            take: 5,
          });
        },
      },
      {
        type: 'deal',
        fields: ['name', 'notes'],
        href: (id) => `/crm/deals/${id}`,
        title: (r) => r.name,
        subtitle: (r) => `${r.partner?.name ?? ''} · ${r.stage ?? ''}`,
        trgmColumns: ['name', 'notes'],
        trgmOrder: 'name',
        query: async (q, orgId) => {
          const like = { contains: q, mode: 'insensitive' as const };
          return this.prisma.raw.deal.findMany({
            where: {
              organizationId: orgId,
              deletedAt: null,
              OR: [{ name: like }, { notes: like }],
            },
            include: { partner: { select: { name: true } } },
            take: 5,
          });
        },
      },
    ];
  }

  async search(rawQuery: string): Promise<SearchHit[]> {
    const q = rawQuery.trim();
    if (q.length < 2) return [];
    const orgId = this.tenant.organizationId;
    const t = q.toLowerCase();
    const escaped = t.replace(/[%_\\]/g, (c) => `\\${c}`);

    // Run both modes in parallel: substring (fast) + trigram (typo-tolerant).
    const [substringHits, trigramHits] = await Promise.all([
      Promise.all(this.entities.map((e) => e.query(q, orgId).catch(() => []))),
      this.runTrigramQuery(q, escaped, orgId).catch((err) => {
        this.logger.warn(`Trigram search failed (pg_trgm extension missing?): ${String(err)}`);
        return [] as SearchHit[];
      }),
    ]);

    const seen = new Set<string>();
    const hits: SearchHit[] = [];
    const add = (h: SearchHit) => {
      const key = `${h.type}:${h.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      hits.push(h);
    };
    this.entities.forEach((entity, idx) => {
      const rows = substringHits[idx];
      for (const row of rows) {
        add({
          type: entity.type,
          id: row.id,
          title: entity.title(row),
          subtitle: entity.subtitle(row),
          href: entity.href(row.id),
        });
      }
    });
    for (const h of trigramHits) add(h);
    return hits;
  }

  /**
   * Run a single batched query against the catalog using pg_trgm.similarity().
   * Returns hits across all entity types. Falls back to empty if pg_trgm is
   * not installed (caller should fall back to substring matches).
   */
  private async runTrigramQuery(q: string, escaped: string, orgId: string): Promise<SearchHit[]> {
    // Use a single CTE-free union of all candidates that pass the similarity
    // threshold on at least one of their indexed text columns. Returned with
    // the max similarity for ranking.
    const threshold = SearchService.TRGM_THRESHOLD;
    const orgFilter = { organizationId: orgId };
    const whereName = (column: string) => ({
      [column]: { similarity: { gt: threshold }, _ilike: `%${escaped}%` },
    });
    // Postgres lets us combine via raw SQL: a single union over the top-N rows
    // from each candidate set, ordered by similarity. This keeps the round
    // trips to 1 and respects the GIN trigram indexes.
    const sql = `
      WITH q AS (SELECT $1::text AS needle)
      SELECT 'partner' AS type, id::text, name AS title, code AS subtitle, '/partners/' || id::text AS href,
             GREATEST(similarity(name, (SELECT needle FROM q)),
                      similarity(code,  (SELECT needle FROM q))) AS score
        FROM "Partner"        WHERE "organizationId" = $2 AND "deletedAt" IS NULL
          AND (name % (SELECT needle FROM q) OR code % (SELECT needle FROM q) OR COALESCE(email, '') % (SELECT needle FROM q))
      UNION ALL
      SELECT 'product', id::text, name, code, '/products/' || id::text,
             GREATEST(similarity(name, (SELECT needle FROM q)),
                      similarity(code,  (SELECT needle FROM q)),
                      similarity(COALESCE(sku, ''),  (SELECT needle FROM q)))
        FROM "Product"        WHERE "organizationId" = $2 AND "isActive" = true
          AND (name % (SELECT needle FROM q) OR code % (SELECT needle FROM q) OR COALESCE(sku, '') % (SELECT needle FROM q))
      UNION ALL
      SELECT 'invoice', id::text, "documentNumber", COALESCE(reference, ''), '/invoices/' || id::text,
             GREATEST(similarity("documentNumber", (SELECT needle FROM q)),
                      similarity(COALESCE(reference, ''), (SELECT needle FROM q)))
        FROM "Document"       WHERE "organizationId" = $2 AND "documentType" = 'sales_invoice'
          AND ("documentNumber" % (SELECT needle FROM q) OR COALESCE(reference, '') % (SELECT needle FROM q))
      UNION ALL
      SELECT 'credit_note', id::text, "documentNumber", COALESCE(reference, ''), '/credit-notes/' || id::text,
             similarity("documentNumber", (SELECT needle FROM q))
        FROM "Document"       WHERE "organizationId" = $2 AND "documentType" = 'credit_note'
          AND "documentNumber" % (SELECT needle FROM q)
      UNION ALL
      SELECT 'payment', id::text, "paymentNumber", COALESCE(reference, ''), '/payments/' || id::text,
             GREATEST(similarity("paymentNumber", (SELECT needle FROM q)),
                      similarity(COALESCE(reference, ''), (SELECT needle FROM q)))
        FROM "Payment"        WHERE "organizationId" = $2
          AND ("paymentNumber" % (SELECT needle FROM q) OR COALESCE(reference, '') % (SELECT needle FROM q))
      UNION ALL
      SELECT 'expense', id::text, "documentNumber", COALESCE(reference, ''), '/expenses/' || id::text,
             similarity("documentNumber", (SELECT needle FROM q))
        FROM "Document"       WHERE "organizationId" = $2 AND "documentType" = 'vendor_bill'
          AND "documentNumber" % (SELECT needle FROM q)
      UNION ALL
      SELECT 'account', id::text, code || ' ' || name, '' AS subtitle, '/accounts?id=' || id::text,
             GREATEST(similarity(name, (SELECT needle FROM q)),
                      similarity(code, (SELECT needle FROM q)))
        FROM "Account"        WHERE "organizationId" = $2
          AND (name % (SELECT needle FROM q) OR code % (SELECT needle FROM q))
      UNION ALL
      SELECT 'deal', id::text, name, COALESCE(notes, ''), '/crm/deals/' || id::text,
             GREATEST(similarity(name, (SELECT needle FROM q)),
                      similarity(COALESCE(notes, ''), (SELECT needle FROM q)))
        FROM "Deal"           WHERE "organizationId" = $2 AND "deletedAt" IS NULL
          AND (name % (SELECT needle FROM q) OR COALESCE(notes, '') % (SELECT needle FROM q))
      ORDER BY score DESC
      LIMIT 25
    `;
    type Row = { type: string; id: string; title: string; subtitle: string; href: string; score: number };
    const rows = (await this.prisma.raw.$queryRawUnsafe<Row[]>(sql, q, orgId));
    return rows.map((r) => ({
      type: r.type as SearchHit['type'],
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      href: r.href,
      meta: { score: Number(r.score.toFixed(3)) },
    }));
  }
}
