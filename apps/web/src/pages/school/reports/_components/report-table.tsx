import { Link } from 'react-router-dom';
import { DataTable, type Column } from '@/components/data-table';
import type { ReportColumn, ReportRow, ReportRunResult } from '@/features/school/reports-api';

/**
 * Renders any report the engine can produce: flat tables, grouped tables with
 * subtotals, and matrix reports whose columns were discovered at run time.
 *
 * Formatting mirrors the server's `report-format.util.ts` so the screen, the
 * CSV and the PDF agree. Where they must differ, the screen is the one that
 * gains: drilldown links exist only here.
 */

const nf = new Intl.NumberFormat('en-UG');

function formatCell(value: unknown, column: ReportColumn): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (column.type) {
    case 'money': {
      const prefix = column.format === '' ? '' : `${column.format ?? 'UGX'} `;
      return `${prefix}${nf.format(Math.round(Number(value)))}`;
    }
    case 'int':
      return nf.format(Math.round(Number(value)));
    case 'percent':
      return `${Math.round(Number(value) * 10) / 10}%`;
    case 'date':
      return new Date(String(value)).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
      });
    case 'datetime':
      return new Date(String(value)).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    case 'bool':
      return value ? 'Yes' : 'No';
    default:
      return String(value);
  }
}

function alignFor(column: ReportColumn): string {
  const numeric = column.type === 'money' || column.type === 'int' || column.type === 'percent';
  const align = column.align ?? (numeric ? 'right' : 'left');
  return align === 'right' ? 'text-right tabular-nums'
    : align === 'center' ? 'text-center' : '';
}

/** Build the drilldown href a column declares, substituting values from the row. */
function linkFor(column: ReportColumn, row: ReportRow): string | null {
  if (!column.link) return null;
  const params = new URLSearchParams();
  for (const [target, source] of Object.entries(column.link.paramFrom)) {
    const v = row[source];
    if (v === null || v === undefined || v === '') return null;
    params.set(target, String(v));
  }
  if ('reportKey' in column.link) {
    return `/school/reports/${column.link.reportKey}?${params.toString()}`;
  }
  // A route template like '/school/students/:studentProfileId'.
  let route = column.link.route;
  for (const [target, source] of Object.entries(column.link.paramFrom)) {
    route = route.replace(`:${target}`, String(row[source]));
  }
  return route;
}

function toDataTableColumns(columns: ReportColumn[]): Column<ReportRow>[] {
  return columns
    .filter((c) => !c.hideOn?.includes('screen'))
    .map((c) => ({
      key: c.key,
      header: c.label,
      className: alignFor(c),
      render: (row: ReportRow) => {
        const text = formatCell(row[c.key], c);
        const href = linkFor(c, row);
        if (!href || text === '—') return text;
        return (
          <Link to={href} className="text-primary underline-offset-2 hover:underline">
            {text}
          </Link>
        );
      },
    }));
}

function TotalsRow({ label, totals, columns }: {
  label: string; totals: ReportRow; columns: ReportColumn[];
}) {
  const visible = columns.filter((c) => !c.hideOn?.includes('screen'));
  return (
    <div className="flex border-t-2 border-foreground/20 bg-muted/50 text-sm font-semibold">
      {visible.map((c, i) => (
        <div key={c.key} className={`flex-1 px-4 py-2 ${alignFor(c)}`}>
          {i === 0 ? label : (c.key in totals ? formatCell(totals[c.key], c) : '')}
        </div>
      ))}
    </div>
  );
}

export function ReportTable({ result, loading }: {
  result: ReportRunResult | undefined;
  loading: boolean;
}) {
  if (!result) {
    return (
      <DataTable
        columns={[{ key: 'x', header: '' }]}
        data={[]}
        loading={loading}
        emptyMessage="Choose your filters, then run the report."
      />
    );
  }

  const columns = toDataTableColumns(result.columns);

  if (result.groups?.length) {
    return (
      <div className="space-y-6">
        {result.groups.map((g) => (
          <div key={g.key}>
            <h3 className="mb-2 text-sm font-semibold">{g.label}</h3>
            <DataTable columns={columns} data={g.rows} compact />
            {g.totals && (
              <TotalsRow label={`${g.label} total`} totals={g.totals} columns={result.columns} />
            )}
          </div>
        ))}
        {result.totals && (
          <TotalsRow label="TOTAL" totals={result.totals} columns={result.columns} />
        )}
      </div>
    );
  }

  return (
    <div>
      {/* A matrix report can be very wide; scroll it inside its own box rather
          than letting the page scroll sideways. */}
      <div className="overflow-x-auto">
        <DataTable
          columns={columns}
          data={result.data}
          loading={loading}
          compact
          emptyMessage="No rows matched these filters."
        />
      </div>
      {result.totals && result.data.length > 0 && (
        // Totals are for the WHOLE report, not this page — the server computes
        // them before paging, so a page-2 total still reads the full figure.
        <TotalsRow label="TOTAL" totals={result.totals} columns={result.columns} />
      )}
    </div>
  );
}
