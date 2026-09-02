import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  ExportFormat,
  ReportCatalogEntry,
  ReportContextBuilder,
  ReportDefinition,
} from './report.types';

/**
 * ReportRegistry — the `reportKey` → definition map.
 *
 * Verticals register their own catalogues at boot (`register('school', defs)`);
 * the registry itself is domain-free, which is what lets HR own an `hr/reporting`
 * catalogue without `school` importing it (school → hr is a hard depcruise error,
 * `.dependency-cruiser.cjs`).
 *
 * Duplicate keys throw at boot rather than last-write-wins. A silently shadowed
 * report is a report that stops matching its own tests.
 */
@Injectable()
export class ReportRegistryService {
  private readonly logger = new Logger('ReportRegistry');
  private readonly definitions = new Map<string, ReportDefinition<any>>();
  /** key → owning namespace, for diagnostics on a duplicate. */
  private readonly owners = new Map<string, string>();
  /**
   * Each namespace brings its own context builder. Resolving `campusId` to class
   * ids needs domain tables core may not import, so the vertical supplies it —
   * and HR's builder will differ from school's, which is why this is held per
   * namespace rather than as one global provider.
   */
  private readonly builders = new Map<string, ReportContextBuilder>();

  register(
    namespace: string,
    defs: ReportDefinition<any>[],
    contextBuilder: ReportContextBuilder,
  ): void {
    this.builders.set(namespace, contextBuilder);
    for (const def of defs) {
      const existing = this.owners.get(def.key);
      if (existing) {
        throw new Error(
          `Duplicate report key "${def.key}": already registered by "${existing}", now also by "${namespace}".`,
        );
      }
      this.owners.set(def.key, namespace);
      this.definitions.set(def.key, def);
    }
    this.logger.log(`Registered ${defs.length} report definition(s) for "${namespace}"`);
  }

  /** All definitions, ignoring permissions. For specs and the smoke test only. */
  all(): ReportDefinition<any>[] {
    return [...this.definitions.values()];
  }

  size(): number {
    return this.definitions.size;
  }

  /** The builder belonging to whichever namespace registered this report. */
  builderFor(key: string): ReportContextBuilder {
    const namespace = this.owners.get(key);
    const builder = namespace ? this.builders.get(namespace) : undefined;
    if (!builder) {
      throw new Error(`No report context builder registered for "${key}" (namespace "${namespace}")`);
    }
    return builder;
  }

  get(key: string): ReportDefinition<any> {
    const def = this.definitions.get(key);
    if (!def) throw new NotFoundException(`Unknown report "${key}"`);
    return def;
  }

  has(key: string): boolean {
    return this.definitions.has(key);
  }

  /** Every grant a caller needs to run this report. */
  requiredPermissions(def: ReportDefinition<any>): string[] {
    return [def.permission, ...(def.alsoRequires ?? [])];
  }

  /**
   * The catalogue a given caller may see.
   *
   * Filtered by permission rather than merely disabled in the UI: the existence
   * of a "Bad Debtors" report is itself information, and a bursar-only catalogue
   * leaking to a class teacher tells them the school tracks it.
   */
  catalog(granted: string[], namespace?: string): ReportCatalogEntry[] {
    const wildcard = granted.includes('*');
    return this.all()
      .filter((def) => (namespace ? this.owners.get(def.key) === namespace : true))
      .filter((def) =>
        wildcard || this.requiredPermissions(def).every((p) => granted.includes(p)),
      )
      .map((def) => this.describe(def))
      .sort((a, b) => a.domain.localeCompare(b.domain) || a.title.localeCompare(b.title));
  }

  /** Serialisable metadata — never the `run` closure. */
  describe(def: ReportDefinition<any>): ReportCatalogEntry {
    const exportFormats: ExportFormat[] =
      def.shape === 'summary' ? ['csv', 'xlsx'] : ['csv', 'xlsx', 'pdf'];
    return {
      key: def.key,
      title: def.title,
      domain: def.domain,
      description: def.description,
      shape: def.shape,
      filters: def.filters,
      requiredFilters: def.requiredFilters ?? [],
      classBasisDefault: def.classBasisDefault,
      asOfMode: def.asOfMode ?? 'live',
      // A matrix report discovers its columns per run, so meta cannot promise them.
      columns: typeof def.columns === 'function' ? undefined : def.columns,
      defaultSort: def.defaultSort,
      groupBy: def.groupBy,
      exportFormats,
    };
  }
}
