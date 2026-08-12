import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
/**
 * Reports page — shift reports + daily/weekly/monthly sales + analytics.
 * Manager-gated (`pos:reports`). Navigated to from the terminal Topbar.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Clock, TrendingUp, RefreshCw, Printer, CalendarDays, Download, FileText, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { useXReport, useZReport, useSalesByHour, useTopItems, useOpenSession, useSalesSummary, useSoldItems, useSalesReport, useCategories, useOrderReport, useCashierReport, useCashierShiftSummary, useWaiterReport, useItemsByGroup } from './api';
import type { XReport as XReportType, SalesSummaryReport, SoldItem, SalesReportRow, OrderReportRow, CashierReportRow, CashierShiftSummaryRow, WaiterReportRow, ItemsByGroupRow } from './types';
import './pos-pro.css';
import { exportCSV } from '@/lib/export-csv';
import { exportPDF } from '@/lib/export-pdf';

const fmt = (n: number | string | null | undefined) =>
  `${orgCur()} ${Number(n || 0).toLocaleString()}`;

/** Local-timezone YYYY-MM-DD. Never use toISOString() here — it's UTC, so in
 *  UTC+ zones it rolls back to "yesterday" during the early-morning hours. */
const isoLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const todayIso = () => isoLocal(new Date());

/** First day (Monday) of the ISO week containing the given ISO date string. */
function weekStartFromDay(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return isoDate;
  const dow = d.getDay();
  const diff = d.getDate() - dow + (dow === 0 ? -6 : 1);
  d.setDate(diff);
  return isoLocal(d);
}

/** YYYY-MM-DD for the first of a YYYY-MM month string. */
function monthStart(ym: string): string {
  return ym + '-01';
}

const ReportsPage: React.FC = () => {
  const permissions = useAuthStore((s) => s.permissions);
  const [tab, setTab] = useState<'sales'| 'items' | 'items-by-group' | 'x' | 'z' | 'daily' | 'weekly' | 'monthly' | 'hourly' | 'top'  | 'orders' | 'cashier' | 'cashier-summary' | 'waiter'>('sales');
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(todayIso());
  const [topCategoryId, setTopCategoryId] = useState<string | undefined>();
  const { data: openSession } = useOpenSession();

  // Each report query is gated on its tab being active so a page load fires ONE
  // request, not all ~13. Switching tabs lazily fetches (and React Query caches).
  const { data: x, isLoading: xLoading, refetch: xRefetch, error: xError } = useXReport(openSession?.id, tab === 'x');
  const { data: z, isLoading: zLoading, refetch: zRefetch, error: zError } = useZReport(openSession?.id, tab === 'z');
  const [hFrom, setHFrom] = useState(todayIso());
  const [hTo, setHTo] = useState(todayIso());
  const [hFilter, setHFilter] = useState<string | undefined>();
  const { data: hourly, isLoading: hLoading } = useSalesByHour(hFrom, hTo, hFilter, tab === 'hourly');
  const { data: topItems, isLoading: tLoading } = useTopItems(fromDate, toDate, 20, topCategoryId, tab === 'top');

  const { data: categories } = useCategories();

  const [itemsFromDate, setItemsFromDate] = useState(todayIso());
  const [itemsToDate, setItemsToDate] = useState(todayIso());
  const [itemsCategoryId, setItemsCategoryId] = useState<string | undefined>();
  const [itemsOrderType, setItemsOrderType] = useState<string | undefined>();
  const { data: soldItems, isLoading: itemsLoading } = useSoldItems(itemsFromDate, itemsToDate, itemsCategoryId, undefined, itemsOrderType, tab === 'items');

  const [salesFromDate, setSalesFromDate] = useState(todayIso());
  const [salesToDate, setSalesToDate] = useState(todayIso());
  const [salesOrderType, setSalesOrderType] = useState<string | undefined>();
  const { data: salesReport, isLoading: salesLoading } = useSalesReport(salesFromDate, salesToDate, undefined, undefined, undefined, salesOrderType, tab === 'sales');

  const [ordersFromDate, setOrdersFromDate] = useState(todayIso());
  const [ordersToDate, setOrdersToDate] = useState(todayIso());
  const [ordersOrderType, setOrdersOrderType] = useState<string | undefined>();
  const { data: orderReport, isLoading: ordersLoading } = useOrderReport(ordersFromDate, ordersToDate, ordersOrderType, undefined, tab === 'orders');

  const [cashierFromDate, setCashierFromDate] = useState(todayIso());
  const [cashierToDate, setCashierToDate] = useState(todayIso());
  const [cashierOrderType, setCashierOrderType] = useState<string | undefined>();
  const { data: cashierReport, isLoading: cashierLoading } = useCashierReport(cashierFromDate, cashierToDate, undefined, undefined, undefined, cashierOrderType, tab === 'cashier');

  const [csFromDate, setCsFromDate] = useState(todayIso());
  const [csToDate, setCsToDate] = useState(todayIso());
  const { data: cashierShiftSummary, isLoading: csLoading } = useCashierShiftSummary(csFromDate, csToDate, undefined, tab === 'cashier-summary');

  const [waiterFromDate, setWaiterFromDate] = useState(todayIso());
    const [waiterToDate, setWaiterToDate] = useState(todayIso());
    const [waiterOrderType, setWaiterOrderType] = useState<string | undefined>();
    const { data: waiterReport, isLoading: waiterLoading } = useWaiterReport(waiterFromDate, waiterToDate, undefined, waiterOrderType, tab === 'waiter');

    const [ibgFromDate, setIbgFromDate] = useState(todayIso());
    const [ibgToDate, setIbgToDate] = useState(todayIso());
    const [ibgOrderType, setIbgOrderType] = useState<string | undefined>();
    const { data: itemsByGroup, isLoading: ibgLoading } = useItemsByGroup(ibgFromDate, ibgToDate, ibgOrderType, tab === 'items-by-group');

  // Daily / weekly / monthly sales summary with from/to ranges
    const [dailyFrom, setDailyFrom] = useState(todayIso());
    const [dailyTo, setDailyTo] = useState(todayIso());
    const { data: daily, isLoading: dailyLoading } = useSalesSummary(dailyFrom, dailyTo, 'day', tab === 'daily');

    const [weeklyFrom, setWeeklyFrom] = useState(todayIso());
    const [weeklyTo, setWeeklyTo] = useState(todayIso());
    const { data: weekly, isLoading: weeklyLoading } = useSalesSummary(weeklyFrom, weeklyTo, 'week', tab === 'weekly');

    const [monthlyFrom, setMonthlyFrom] = useState(todayIso());
    const [monthlyTo, setMonthlyTo] = useState(todayIso());
    const { data: monthly, isLoading: monthlyLoading } = useSalesSummary(monthlyFrom, monthlyTo, 'month', tab === 'monthly');

  const denied = !permissions.includes('pos:reports');

  return (
    <div className="pos-reports-shell">
      <div className="pos-reports-header">
        <div>
          <h1 className="text-2xl font-bold flex items-center">
            <BarChart3 className="h-6 w-6" /> POS Reports
          </h1>
        </div>
        <div className="flex gap-2 no-print">
          {tab === 'x' ? (
            <Button variant="outline" onClick={() => xRefetch()}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
          ) : tab === 'z' ? (
            <Button variant="outline" onClick={() => zRefetch()}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
          ) : null}
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" /> Print</Button>
        </div>
      </div>

      {denied ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-700">
          You don't have <code>pos:reports</code> permission. Ask a manager.
        </div>
      ) : (
        <>
          <div className="pos-reports-tabs pos-reports-tabs-wide no-print">
            <button className={'pos-reports-tab' + (tab === 'sales' ? ' active' : '')} onClick={() => setTab('sales')}>
              Sales Report
            </button>
            <button className={'pos-reports-tab' + (tab === 'items' ? ' active' : '')} onClick={() => setTab('items')}>
              Items Report
            </button>
            <button className={'pos-reports-tab' + (tab === 'items-by-group' ? ' active' : '')} onClick={() => setTab('items-by-group')}>
              Items by Group
            </button>
            <button className={'pos-reports-tab' + (tab === 'orders' ? ' active' : '')} onClick={() => setTab('orders')}>
              Order Reports
            </button>
            <button className={'pos-reports-tab' + (tab === 'cashier' ? ' active' : '')} onClick={() => setTab('cashier')}>
              Cashier Reports
            </button>
            <button className={'pos-reports-tab' + (tab === 'cashier-summary' ? ' active' : '')} onClick={() => setTab('cashier-summary')}>
              Cashier Shift Summary
            </button>
            <button className={'pos-reports-tab' + (tab === 'waiter' ? ' active' : '')} onClick={() => setTab('waiter')}>
                          Waiter Report
                        </button>
                        <button className={'pos-reports-tab' + (tab === 'daily' ? ' active' : '')} onClick={() => setTab('daily')}>
              Daily Sales
            </button>
            <button className={'pos-reports-tab' + (tab === 'weekly' ? ' active' : '')} onClick={() => setTab('weekly')}>
              Weekly Sales
            </button>
            <button className={'pos-reports-tab' + (tab === 'monthly' ? ' active' : '')} onClick={() => setTab('monthly')}>
              Monthly Sales
            </button>
            <button className={'pos-reports-tab' + (tab === 'hourly' ? ' active' : '')} onClick={() => setTab('hourly')}>
              Sales by hour
            </button>
            <button className={'pos-reports-tab' + (tab === 'top' ? ' active' : '')} onClick={() => setTab('top')}>
              Top items
            </button>
            <button className={'pos-reports-tab' + (tab === 'x' ? ' active' : '')} onClick={() => setTab('x')}>
              X-Report
            </button>
            <button className={'pos-reports-tab' + (tab === 'z' ? ' active' : '')} onClick={() => setTab('z')}>
              Z-Report
            </button>
          </div>

          {tab === 'x' ? (
            <XReportView report={x as any} loading={xLoading} error={xError as any} kind="X" />
          ) : tab === 'z' ? (
            <XReportView report={z as any} loading={zLoading} error={zError as any} kind="Z" />
          ) : tab === 'daily' ? (
            <DailySalesView
              fromDate={dailyFrom} setFromDate={setDailyFrom}
              toDate={dailyTo} setToDate={setDailyTo}
              report={daily as SalesSummaryReport | undefined}
              loading={dailyLoading}
            />
          ) : tab === 'weekly' ? (
            <WeeklySalesView
              fromDate={weeklyFrom} setFromDate={setWeeklyFrom}
              toDate={weeklyTo} setToDate={setWeeklyTo}
              report={weekly as SalesSummaryReport | undefined}
              loading={weeklyLoading}
            />
          ) : tab === 'monthly' ? (
            <MonthlySalesView
              fromDate={monthlyFrom} setFromDate={setMonthlyFrom}
              toDate={monthlyTo} setToDate={setMonthlyTo}
              report={monthly as SalesSummaryReport | undefined}
              loading={monthlyLoading}
            />
          ) : tab === 'hourly' ? (
            <HourlyView
              fromDate={hFrom} setFromDate={setHFrom}
              toDate={hTo} setToDate={setHTo}
              hFilter={hFilter} setHFilter={setHFilter}
              data={hourly as any} loading={hLoading}
            />
          ) : tab === 'sales' ? (
            <SalesReportView
              fromDate={salesFromDate} setFromDate={setSalesFromDate}
              toDate={salesToDate} setToDate={setSalesToDate}
              orderType={salesOrderType} setOrderType={setSalesOrderType}
              rows={(salesReport as SalesReportRow[]) ?? []} loading={salesLoading}
            />
          ) : tab === 'cashier' ? (
            <CashierReportView
              fromDate={cashierFromDate} setFromDate={setCashierFromDate}
              toDate={cashierToDate} setToDate={setCashierToDate}
              orderType={cashierOrderType} setOrderType={setCashierOrderType}
              rows={(cashierReport as CashierReportRow[]) ?? []} loading={cashierLoading}
            />
          ) : tab === 'cashier-summary' ? (
            <CashierShiftSummaryView
              fromDate={csFromDate} setFromDate={setCsFromDate}
              toDate={csToDate} setToDate={setCsToDate}
              rows={(cashierShiftSummary as CashierShiftSummaryRow[]) ?? []} loading={csLoading}
            />
          ) : tab === 'waiter' ? (
                      <WaiterReportView
                        fromDate={waiterFromDate} setFromDate={setWaiterFromDate}
                        toDate={waiterToDate} setToDate={setWaiterToDate}
                        orderType={waiterOrderType} setOrderType={setWaiterOrderType}
                        rows={(waiterReport as WaiterReportRow[]) ?? []} loading={waiterLoading}
                      />
                    ) : tab === 'items-by-group' ? (
                      <ItemsByGroupView
                        fromDate={ibgFromDate} setFromDate={setIbgFromDate}
                        toDate={ibgToDate} setToDate={setIbgToDate}
                        orderType={ibgOrderType} setOrderType={setIbgOrderType}
                        rows={(itemsByGroup as ItemsByGroupRow[]) ?? []} loading={ibgLoading}
                      />
                    ) : tab === 'orders' ? (
            <OrderReportView
              fromDate={ordersFromDate} setFromDate={setOrdersFromDate}
              toDate={ordersToDate} setToDate={setOrdersToDate}
              orderType={ordersOrderType} setOrderType={setOrdersOrderType}
              rows={(orderReport as OrderReportRow[]) ?? []} loading={ordersLoading}
            />
          ) : tab === 'items' ? (
            <ItemsReportView
              fromDate={itemsFromDate} setFromDate={setItemsFromDate}
              toDate={itemsToDate} setToDate={setItemsToDate}
              categoryId={itemsCategoryId} setCategoryId={setItemsCategoryId}
              orderType={itemsOrderType} setOrderType={setItemsOrderType}
              categories={categories ?? []}
              items={(soldItems as SoldItem[]) ?? []} loading={itemsLoading}
            />
          ) : (
            <TopItemsView
              fromDate={fromDate} setFromDate={setFromDate}
              toDate={toDate} setToDate={setToDate}
              categoryId={topCategoryId} setCategoryId={setTopCategoryId}
              categories={(categories ?? []) as Array<{ id: string; name: string; icon?: string | null }>}
              items={(topItems as any) ?? []} loading={tLoading}
            />
          )}
        </>
      )}
    </div>
  );
};

/* ============== X / Z ============== */

const XReportView: React.FC<{ report: XReportType | null; loading: boolean; error: any; kind: 'X' | 'Z' }> = ({ report, loading, error, kind }) => {
  if (loading) return <div className="text-slate-500 p-4">Loading {kind}-report…</div>;
  if (error) {
    const msg = error?.response?.data?.message || error?.message || 'Failed to load report';
    return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-700">{msg}</div>;
  }
  if (!report || !report.cashSession) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">
        <Clock className="h-10 w-10 mx-auto mb-2 opacity-50" />
        <p className="font-semibold">No active cash session</p>
        <p className="text-sm mt-1">Open a shift to see live {kind}-report data.</p>
      </div>
    );
  }

  const t = report.totals;
  const maxCategory = Math.max(1, ...report.byCategory.map((c) => Number(c.total)));
  const maxMethod = Math.max(1, ...report.byMethod.map((m) => Number(m.total)));

  return (
    <div className="space-y-4">
      <div className="pos-shift-banner">
        <span>
          Shift opened {report.cashSession.openedAt ? new Date(report.cashSession.openedAt).toLocaleString() : '—'}
        </span>
        <span className="font-mono">Opening float: {fmt(report.cashSession.openingFloat)}</span>
      </div>

      <div className="pos-report-grid">
        <ReportCard title="Gross sales" value={fmt(t.grossSales)} sub={`incl. tax · ${t.saleCount} sale${t.saleCount === 1 ? '' : 's'}`} />
        <ReportCard title="Discounts" value={fmt(t.discountTotal)} sub="given this shift" />
        <ReportCard title="Cash collected" value={fmt(t.cashCollected)} sub="cash tenders into drawer" />
        <ReportCard title="Expected cash" value={fmt(t.expectedCash)} sub={`float + cash + in − out`} accent />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="pos-report-card">
          <h3>By payment method <span className="text-sm font-normal text-slate-400">(all tenders, gross)</span></h3>
          {report.byMethod.length === 0 ? (
            <p className="text-sm text-slate-500">No sales yet this shift.</p>
          ) : (
            <div>
              {report.byMethod.map((m) => (
                <div key={m.method} className="pos-report-bar-row">
                  <div className="pos-report-bar-label">{m.method}</div>
                  <div className="pos-report-bar-track">
                    <div
                      className="pos-report-bar-fill"
                      style={{ width: `${(Number(m.total) / maxMethod) * 100}%` }}
                    />
                  </div>
                  <div className="pos-report-bar-value">{fmt(m.total)} ({m.count})</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pos-report-card">
          <h3>By category</h3>
          {report.byCategory.length === 0 ? (
            <p className="text-sm text-slate-500">No sales yet this shift.</p>
          ) : (
            <div>
              {report.byCategory.map((c) => (
                <div key={c.categoryId ?? 'uncategorised'} className="pos-report-bar-row">
                  <div className="pos-report-bar-label">{c.categoryName}</div>
                  <div className="pos-report-bar-track">
                    <div
                      className="pos-report-bar-fill"
                      style={{ width: `${(Number(c.total) / maxCategory) * 100}%` }}
                    />
                  </div>
                  <div className="pos-report-bar-value">{fmt(c.total)} ({c.count})</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-sm text-slate-500">As of {new Date(report.asOf).toLocaleString()}</p>
    </div>
  );
};

const ReportCard: React.FC<{ title: string; value: string; sub?: string; accent?: boolean }> = ({ title, value, sub, accent }) => (
  <div className="pos-report-card">
    <h3>{title}</h3>
    <div className={'big ' + (accent ? 'text-emerald-600' : '')}>{value}</div>
    {sub ? <p className="text-sm text-slate-500 mt-1">{sub}</p> : null}
  </div>
);

/* ============== Quick Presets ============== */

const QuickPresets: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
}> = ({ fromDate, setFromDate, toDate, setToDate }) => {
  const presets = [
    { label: 'Today', get: () => { const t = todayIso(); return { f: t, t: t }; } },
    { label: 'Yesterday', get: () => { const d = new Date(); d.setDate(d.getDate() - 1); const s = isoLocal(d); return { f: s, t: s }; } },
    { label: 'This Week', get: () => { const s = weekStartFromDay(todayIso()); return { f: s, t: todayIso() }; } },
    { label: 'This Month', get: () => { const s = monthStart(todayIso().slice(0, 7)); return { f: s, t: todayIso() }; } },
    { label: 'Last 7 Days', get: () => { const d = new Date(); d.setDate(d.getDate() - 6); return { f: isoLocal(d), t: todayIso() }; } },
    { label: 'Last 30 Days', get: () => { const d = new Date(); d.setDate(d.getDate() - 29); return { f: isoLocal(d), t: todayIso() }; } },
    { label: 'This Year', get: () => { const y = todayIso().slice(0, 4); return { f: y + '-01-01', t: todayIso() }; } },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((p) => {
        const { f, t } = p.get();
        const active = fromDate === f && toDate === t;
        return (
          <button
            key={p.label}
            className={'pos-reports-tab ' + (active ? 'active' : '')}
            style={{ fontSize: 14, padding: '2px 8px' }}
            onClick={() => { setFromDate(f); setToDate(t); }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
};

const ORDER_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'dine_in', label: 'Dine In' },
  { value: 'takeaway', label: 'Takeaway' },
  { value: 'delivery', label: 'Delivery' },
];

const OrderTypeSelect: React.FC<{
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}> = ({ value, onChange }) => (
  <div>
    <Label>Order Type</Label>
    <select
      className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      {ORDER_TYPES.map((ot) => (
        <option key={ot.value} value={ot.value}>{ot.label}</option>
      ))}
    </select>
  </div>
);

/* ============== Hourly ============== */

const HourlyView: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
  hFilter: string | undefined; setHFilter: (h: string | undefined) => void;
  data: any; loading: boolean;
}> = ({ fromDate, setFromDate, toDate, setToDate, hFilter, setHFilter, data, loading }) => {
  const buckets: Array<{ hour: number; count: number; total: string }> = data?.buckets ?? [];
  const allHours = Array.from({ length: 24 }, (_, i) => i);
  const selectedHours = hFilter ? new Set(hFilter.split(',').map(Number)) : null;
  const max = Math.max(1, ...buckets.map((b) => Number(b.total)));
  const peak = buckets.reduce((best, b) => (Number(b.total) > Number(best.total) ? b : best), buckets[0] ?? { hour: 0, total: '0', count: 0 });

  const toggleHour = (hour: number) => {
    const current = hFilter ? hFilter.split(',').map(Number) : [];
    const idx = current.indexOf(hour);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(hour);
    setHFilter(current.length > 0 && current.length < 24 ? current.join(',') : undefined);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div>
          <Label>From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        {peak && Number(peak.total) > 0 ? (
          <div className="pos-shift-banner" style={{ marginLeft: 'auto' }}>
            <TrendingUp className="h-3.5 w-3.5" /> Peak hour: {peak.hour}:00–{peak.hour + 1}:00 · {fmt(peak.total)} ({peak.count} sale{peak.count === 1 ? '' : 's'})
          </div>
        ) : null}
      </div>

      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />

      <div className="flex flex-wrap gap-1">
        <Label className="w-full text-sm text-slate-500 mb-1">Filter by hour:</Label>
        {allHours.map((h) => {
          const active = !selectedHours || selectedHours.has(h);
          return (
            <button
              key={h}
              className={'pos-reports-tab ' + (active ? 'active' : '')}
              style={{ fontSize: 13, padding: '1px 6px' }}
              onClick={() => toggleHour(h)}
            >
              {String(h).padStart(2, '0')}:00
            </button>
          );
        })}
      </div>

      <div className="pos-report-card">
        <h3>Hourly sales — {fromDate} → {toDate}</h3>
        {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        <div>
          {buckets.map((b) => {
            const show = !selectedHours || selectedHours.has(b.hour);
            if (!show) return null;
            return (
              <div key={b.hour} className="pos-report-bar-row">
                <div className="pos-report-bar-label">{String(b.hour).padStart(2, '0')}:00</div>
                <div className="pos-report-bar-track">
                  <div
                    className="pos-report-bar-fill"
                    style={{ width: `${(Number(b.total) / max) * 100}%` }}
                  />
                </div>
                <div className="pos-report-bar-value">{fmt(b.total)} ({b.count})</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* ============== Top items ============== */

const TopItemsView: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
  categoryId: string | undefined; setCategoryId: (id: string | undefined) => void;
  categories: Array<{ id: string; name: string; icon?: string | null }>;
  items: Array<{ productId: string; name: string; sku: string | null; quantity: number; total: string }>;
  loading: boolean;
}> = ({ fromDate, setFromDate, toDate, setToDate, categoryId, setCategoryId, categories, items, loading }) => {
  const total = items.reduce((s, i) => s + Number(i.total), 0);
  const topCsvHeaders = ['#', 'Item', 'SKU', 'Qty', 'Total', '% of sales'];
  const handleTopCSV = () => {
    const data = items.map((it, i) => [
      String(i + 1), it.name, it.sku ?? '—', String(it.quantity),
      String(Number(it.total).toFixed(2)),
      total > 0 ? ((Number(it.total) / total) * 100).toFixed(1) + '%' : '—',
    ]);
    exportCSV(`top-items-${fromDate}-${toDate}.csv`, topCsvHeaders, data);
  };
  const handleTopPDF = () => {
    const data = items.map((it, i) => [
      String(i + 1), it.name, it.sku ?? '—', String(it.quantity),
      fmt(it.total),
      total > 0 ? ((Number(it.total) / total) * 100).toFixed(1) + '%' : '—',
    ]);
    exportPDF(`top-items-${fromDate}-${toDate}.pdf`, `Top Items — ${fromDate} → ${toDate}`, topCsvHeaders, data);
  };
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div>
          <Label>From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div>
          <Label>Category</Label>
          <select
            className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm"
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value || undefined)}
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto pos-report-card" style={{ minWidth: 220 }}>
          <h3>Period total</h3>
          <div className="big">{fmt(total)}</div>
        </div>
      </div>
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />

      <div className="pos-report-card">
        <div className="flex items-center justify-between mb-2">
          <h3>Top 20 items — {fromDate} → {toDate}</h3>
          {items.length > 0 && (
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={handleTopCSV}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={handleTopPDF}><FileText className="h-3.5 w-3.5 mr-1" /> PDF</Button>
            </div>
          )}
        </div>
        {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {items.length === 0 && !loading ? (
          <p className="text-sm text-slate-500">No sales in this date range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200 text-slate-600">
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3">SKU</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3 text-right">Total</th>
                  <th className="py-2 pr-3 text-right">% of sales</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.productId || it.name} className="border-b border-slate-100">
                    <td className="py-2 pr-3 text-slate-500">{i + 1}</td>
                    <td className="py-2 pr-3 font-semibold">{it.name}</td>
                    <td className="py-2 pr-3 text-slate-500 font-mono text-sm">{it.sku ?? '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono">{it.quantity}</td>
                    <td className="py-2 pr-3 text-right font-mono font-bold">{fmt(it.total)}</td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {total > 0 ? `${((Number(it.total) / total) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/* ============== Sales Report ============== */

const SalesReportView: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
  orderType: string | undefined; setOrderType: (v: string | undefined) => void;
  rows: SalesReportRow[];
  loading: boolean;
}> = ({ fromDate, setFromDate, toDate, setToDate, orderType, setOrderType, rows, loading }) => {
  const navigate = useNavigate();
  const totals = rows.reduce(
    (s, r) => ({
      subtotal: s.subtotal + Number(r.subtotal),
      discount: s.discount + Number(r.discount),
      totalAmount: s.totalAmount + Number(r.totalAmount),
    }),
    { subtotal: 0, discount: 0, totalAmount: 0 },
  );
  const sCsvHeaders = ['Order #', 'Invoice #', 'Sale Date', 'Time', 'Subtotal', 'Discount', 'Total Amount', 'Waiter'];
  const handleSalesCSV = () => {
    const data = rows.map((r) => [
      r.orderNumber, r.invoiceNumber, new Date(r.saleDate).toLocaleDateString(), r.time || new Date(r.saleDate).toLocaleTimeString(),
      String(Number(r.subtotal).toFixed(2)), String(Number(r.discount).toFixed(2)),
      String(Number(r.totalAmount).toFixed(2)), r.waiterName ?? '—',
    ]);
    exportCSV(`sales-report-${fromDate}-${toDate}.csv`, sCsvHeaders, data);
  };
  const handleSalesPDF = () => {
    const data = rows.map((r) => [
      r.orderNumber, r.invoiceNumber, new Date(r.saleDate).toLocaleDateString(), r.time || new Date(r.saleDate).toLocaleTimeString(),
      fmt(r.subtotal), fmt(r.discount), fmt(r.totalAmount), r.waiterName ?? '—',
    ]);
    exportPDF(`sales-report-${fromDate}-${toDate}.pdf`, `Sales Report — ${fromDate} → ${toDate}`, sCsvHeaders, data);
  };
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div>
          <Label>From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <OrderTypeSelect value={orderType} onChange={setOrderType} />
      </div>
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />

      <div className="pos-report-card">
        <div className="flex items-center justify-between mb-2">
          <h3>Sales Report — {fromDate} → {toDate}</h3>
          {rows.length > 0 && (
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={handleSalesCSV}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={handleSalesPDF}><FileText className="h-3.5 w-3.5 mr-1" /> PDF</Button>
            </div>
          )}
        </div>
        {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {rows.length === 0 && !loading ? (
          <p className="text-sm text-slate-500">No sales in this date range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200 text-slate-600">
                  <th className="py-2 pr-3">Order #</th>
                  <th className="py-2 pr-3">Invoice #</th>
                  <th className="py-2 pr-3">Sale Date</th>
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3 text-right">Subtotal</th>
                  <th className="py-2 pr-3 text-right">Discount</th>
                  <th className="py-2 pr-3 text-right">Total Amount</th>
                  <th className="py-2 pr-3">Waiter</th>
                  <th className="py-2 pr-3 w-16 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-mono text-sm">{r.orderNumber}</td>
                    <td className="py-2 pr-3 font-mono text-sm">{r.invoiceNumber}</td>
                    <td className="py-2 pr-3 text-sm">{new Date(r.saleDate).toLocaleDateString()}</td>
                    <td className="py-2 pr-3 text-sm">{r.time || new Date(r.saleDate).toLocaleTimeString()}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmt(r.subtotal)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmt(r.discount)}</td>
                    <td className="py-2 pr-3 text-right font-mono font-bold">{fmt(r.totalAmount)}</td>
                    <td className="py-2 pr-3 text-sm">{r.waiterName ?? '—'}</td>
                    <td className="py-2 pr-3 text-center">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate(`/invoices/${r.id}`)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                  <td className="py-2 pr-3" colSpan={4}>Total</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(totals.subtotal)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(totals.discount)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(totals.totalAmount)}</td>
                  <td className="py-2 pr-3" />
                  <td className="py-2 pr-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/* ============== Cashier Reports ============== */

const CashierReportView: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
  orderType: string | undefined; setOrderType: (v: string | undefined) => void;
  rows: CashierReportRow[];
  loading: boolean;
}> = ({ fromDate, setFromDate, toDate, setToDate, orderType, setOrderType, rows, loading }) => {
  const totals = rows.reduce(
    (s, r) => ({ salesAmount: s.salesAmount + Number(r.salesAmount), received: s.received + Number(r.received) }),
    { salesAmount: 0, received: 0 },
  );
  const cashierCsvHeaders = ['Cashier', 'Order', 'Invoice', 'Time', 'Sales Amount', 'Payment Method', 'Received'];
  const handleCashierCSV = () => {
    const data = rows.map((r) => [
      r.cashierName ?? '—', r.orderNumber, r.invoiceNumber, r.time || '',
      String(Number(r.salesAmount).toFixed(2)), r.paymentMethod ?? '—',
      String(Number(r.received).toFixed(2)),
    ]);
    exportCSV(`cashier-report-${fromDate}-${toDate}.csv`, cashierCsvHeaders, data);
  };
  const handleCashierPDF = () => {
    const data = rows.map((r) => [
      r.cashierName ?? '—', r.orderNumber, r.invoiceNumber, r.time || '',
      fmt(r.salesAmount), r.paymentMethod ?? '—', fmt(r.received),
    ]);
    exportPDF(`cashier-report-${fromDate}-${toDate}.pdf`, `Cashier Report — ${fromDate} → ${toDate}`, cashierCsvHeaders, data);
  };
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div>
          <Label>From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <OrderTypeSelect value={orderType} onChange={setOrderType} />
      </div>
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />

      <div className="pos-report-card">
        <div className="flex items-center justify-between mb-2">
          <h3>Cashier Reports — {fromDate} → {toDate}</h3>
          {rows.length > 0 && (
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={handleCashierCSV}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={handleCashierPDF}><FileText className="h-3.5 w-3.5 mr-1" /> PDF</Button>
            </div>
          )}
        </div>
        {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {rows.length === 0 && !loading ? (
          <p className="text-sm text-slate-500">No sales in this date range.</p>
        ) : (
          <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-slate-200 text-slate-600">
                    <th className="py-2 pr-3">Cashier</th>
                    <th className="py-2 pr-3">Order</th>
                    <th className="py-2 pr-3">Invoice</th>
                    <th className="py-2 pr-3">Time</th>
                    <th className="py-2 pr-3 text-right">Sales Amount</th>
                    <th className="py-2 pr-3">Payment Method</th>
                    <th className="py-2 pr-3 text-right">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-2 pr-3 text-sm">{r.cashierName ?? '—'}</td>
                      <td className="py-2 pr-3 font-mono text-sm">{r.orderNumber}</td>
                      <td className="py-2 pr-3 font-mono text-sm">{r.invoiceNumber}</td>
                      <td className="py-2 pr-3 text-sm">{r.time || ''}</td>
                      <td className="py-2 pr-3 text-right font-mono">{fmt(r.salesAmount)}</td>
                      <td className="py-2 pr-3 text-sm capitalize">{r.paymentMethod ?? '—'}</td>
                      <td className="py-2 pr-3 text-right font-mono font-bold">{fmt(r.received)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                    <td className="py-2 pr-3" colSpan={4}>Total ({rows.length} sales)</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmt(totals.salesAmount)}</td>
                    <td className="py-2 pr-3" />
                    <td className="py-2 pr-3 text-right font-mono">{fmt(totals.received)}</td>
                  </tr>
                </tfoot>
              </table>
          </div>
        )}
      </div>
    </div>
  );
};

/* ============== Cashier Shift Summary ============== */

const CashierShiftSummaryView: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
  rows: CashierShiftSummaryRow[];
  loading: boolean;
}> = ({ fromDate, setFromDate, toDate, setToDate, rows, loading }) => {
  const totals = rows.reduce(
    (s, r) => ({
      openingCash: s.openingCash + Number(r.openingCash),
      sales: s.sales + Number(r.sales),
      expectedCash: s.expectedCash + Number(r.expectedCash),
      actualCash: s.actualCash + (r.actualCash ? Number(r.actualCash) : 0),
      difference: s.difference + (r.difference ? Number(r.difference) : 0),
    }),
    { openingCash: 0, sales: 0, expectedCash: 0, actualCash: 0, difference: 0 },
  );
  const csCsvHeaders = ['Shift', 'Cashier', 'Opening Cash', 'Sales', 'Expected Cash', 'Actual Cash', 'Difference'];
  const handleCS_CSV = () => {
    const data = rows.map((r) => [
      r.shift, r.cashierName ?? '—', String(Number(r.openingCash).toFixed(2)),
      String(Number(r.sales).toFixed(2)), String(Number(r.expectedCash).toFixed(2)),
      r.actualCash ? String(Number(r.actualCash).toFixed(2)) : '—',
      r.difference ? String(Number(r.difference).toFixed(2)) : '—',
    ]);
    exportCSV(`cashier-shift-summary-${fromDate}-${toDate}.csv`, csCsvHeaders, data);
  };
  const handleCS_PDF = () => {
    const data = rows.map((r) => [
      r.shift, r.cashierName ?? '—', fmt(r.openingCash), fmt(r.sales),
      fmt(r.expectedCash), r.actualCash ? fmt(r.actualCash) : '—',
      r.difference ? fmt(r.difference) : '—',
    ]);
    exportPDF(`cashier-shift-summary-${fromDate}-${toDate}.pdf`, `Cashier Shift Summary — ${fromDate} → ${toDate}`, csCsvHeaders, data);
  };
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div>
          <Label>From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />

      <div className="pos-report-card">
        <div className="flex items-center justify-between mb-2">
          <h3>Cashier Shift Summary — {fromDate} → {toDate}</h3>
          {rows.length > 0 && (
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={handleCS_CSV}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={handleCS_PDF}><FileText className="h-3.5 w-3.5 mr-1" /> PDF</Button>
            </div>
          )}
        </div>
        {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {rows.length === 0 && !loading ? (
          <p className="text-sm text-slate-500">No shifts in this date range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200 text-slate-600">
                  <th className="py-2 pr-3">Shift</th>
                  <th className="py-2 pr-3">Cashier</th>
                  <th className="py-2 pr-3 text-right">Opening Cash</th>
                  <th className="py-2 pr-3 text-right">Sales</th>
                  <th className="py-2 pr-3 text-right">Expected Cash</th>
                  <th className="py-2 pr-3 text-right">Actual Cash</th>
                  <th className="py-2 pr-3 text-right">Difference</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 pr-3 text-sm font-mono">{r.shift}</td>
                    <td className="py-2 pr-3 text-sm">{r.cashierName ?? '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmt(r.openingCash)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmt(r.sales)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmt(r.expectedCash)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{r.actualCash ? fmt(r.actualCash) : '—'}</td>
                    <td className={`py-2 pr-3 text-right font-mono ${r.difference ? (Number(r.difference) < 0 ? 'text-rose-600' : Number(r.difference) > 0 ? 'text-emerald-600' : '') : ''}`}>
                      {r.difference ? fmt(r.difference) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                  <td className="py-2 pr-3" colSpan={2}>Total ({rows.length} shift{rows.length === 1 ? '' : 's'})</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(totals.openingCash)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(totals.sales)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(totals.expectedCash)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(totals.actualCash)}</td>
                  <td className={`py-2 pr-3 text-right font-mono ${totals.difference < 0 ? 'text-rose-600' : totals.difference > 0 ? 'text-emerald-600' : ''}`}>
                    {fmt(totals.difference)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/* ============== Waiter Report ============== */

const WaiterReportView: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
  orderType: string | undefined; setOrderType: (v: string | undefined) => void;
  rows: WaiterReportRow[];
  loading: boolean;
}> = ({ fromDate, setFromDate, toDate, setToDate, orderType, setOrderType, rows, loading }) => {
  const totals = rows.reduce(
    (s, r) => ({
      quantity: s.quantity + Number(r.quantity),
      total: s.total + Number(r.total),
    }),
    { quantity: 0, total: 0 },
  );
  const waiterCsvHeaders = ['Waiter', 'Order #', 'Table', 'Item', 'Qty', 'Unit Price', 'Discount %', 'Total', 'Date', 'Time'];
  const handleWaiterCSV = () => {
    const data = rows.map((r) => [
      r.waiterName ?? '—', r.orderNumber, r.tableName ?? '—', r.item,
      String(Number(r.quantity).toFixed(2)), String(Number(r.unitPrice).toFixed(2)),
      r.discountPercent, String(Number(r.total).toFixed(2)),
      new Date(r.date).toLocaleDateString(), r.time || new Date(r.date).toLocaleTimeString(),
    ]);
    exportCSV(`waiter-report-${fromDate}-${toDate}.csv`, waiterCsvHeaders, data);
  };
  const handleWaiterPDF = () => {
    const data = rows.map((r) => [
      r.waiterName ?? '—', r.orderNumber, r.tableName ?? '—', r.item,
      String(Number(r.quantity).toFixed(2)), fmt(r.unitPrice),
      `${r.discountPercent}%`, fmt(r.total),
      new Date(r.date).toLocaleDateString(), r.time || new Date(r.date).toLocaleTimeString(),
    ]);
    exportPDF(`waiter-report-${fromDate}-${toDate}.pdf`, `Waiter Report — ${fromDate} → ${toDate}`, waiterCsvHeaders, data);
  };
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div>
          <Label>From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <OrderTypeSelect value={orderType} onChange={setOrderType} />
      </div>
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />

      <div className="pos-report-card">
        <div className="flex items-center justify-between mb-2">
          <h3>Waiter Report — {fromDate} → {toDate}</h3>
          {rows.length > 0 && (
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={handleWaiterCSV}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={handleWaiterPDF}><FileText className="h-3.5 w-3.5 mr-1" /> PDF</Button>
            </div>
          )}
        </div>
        {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {rows.length === 0 && !loading ? (
          <p className="text-sm text-slate-500">No sales in this date range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200 text-slate-600">
                  <th className="py-2 pr-3">Waiter</th>
                  <th className="py-2 pr-3">Order #</th>
                  <th className="py-2 pr-3">Table</th>
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3 text-right">Unit Price</th>
                  <th className="py-2 pr-3 text-right">Discount %</th>
                  <th className="py-2 pr-3 text-right">Total</th>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 pr-3 text-sm">{r.waiterName ?? '—'}</td>
                    <td className="py-2 pr-3 font-mono text-sm">{r.orderNumber}</td>
                    <td className="py-2 pr-3 text-sm">{r.tableName ?? '—'}</td>
                    <td className="py-2 pr-3 font-semibold">{r.item}</td>
                    <td className="py-2 pr-3 text-right font-mono">{r.quantity}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmt(r.unitPrice)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{r.discountPercent}%</td>
                    <td className="py-2 pr-3 text-right font-mono font-bold">{fmt(r.total)}</td>
                    <td className="py-2 pr-3 text-sm">{new Date(r.date).toLocaleDateString()}</td>
                    <td className="py-2 pr-3 text-sm">{r.time || new Date(r.date).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                  <td className="py-2 pr-3" colSpan={4}>Total</td>
                  <td className="py-2 pr-3 text-right font-mono">{totals.quantity.toFixed(2)}</td>
                  <td className="py-2 pr-3" colSpan={3} />
                  <td className="py-2 pr-3 text-right font-mono">{fmt(totals.total)}</td>
                  <td className="py-2 pr-3" />
                </tr>
              </tfoot>
            </table>
                      </div>
                    )}
                  </div>
                </div>
              );
            };

            /* ============== Items by Group ============== */

            const ItemsByGroupView: React.FC<{
              fromDate: string; setFromDate: (d: string) => void;
              toDate: string; setToDate: (d: string) => void;
              orderType: string | undefined; setOrderType: (v: string | undefined) => void;
              rows: ItemsByGroupRow[];
              loading: boolean;
            }> = ({ fromDate, setFromDate, toDate, setToDate, orderType, setOrderType, rows, loading }) => {
              const grandTotalQty = rows.reduce((s, r) => s + Number(r.totalQuantity), 0);
              const grandTotalAmt = rows.reduce((s, r) => s + Number(r.totalAmount), 0);
              const grandTotalItems = rows.reduce((s, r) => s + r.itemCount, 0);
  
              const ibgCsvHeaders = ['Item Group', 'Items Count', 'Total Quantity', 'Total Amount'];
              const handleIBGCsv = () => {
                const data = rows.map((r) => [
                  r.groupName, String(r.itemCount), String(Number(r.totalQuantity).toFixed(2)), String(Number(r.totalAmount).toFixed(2)),
                ]);
                exportCSV(`items-by-group-${fromDate}-${toDate}.csv`, ibgCsvHeaders, data);
              };
              const handleIBGPdf = () => {
                const data = rows.map((r) => [
                  r.groupName, String(r.itemCount), String(Number(r.totalQuantity).toFixed(2)), fmt(r.totalAmount),
                ]);
                exportPDF(`items-by-group-${fromDate}-${toDate}.pdf`, `Items by Group — ${fromDate} → ${toDate}`, ibgCsvHeaders, data);
              };
  
              return (
                <div className="space-y-4">
                  <div className="flex items-end gap-2">
                    <div>
                      <Label>From</Label>
                      <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                    </div>
                    <div>
                      <Label>To</Label>
                      <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                    </div>
                    <OrderTypeSelect value={orderType} onChange={setOrderType} />
                  </div>
                  <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />

                  <div className="pos-report-card">
                    <div className="flex items-center justify-between mb-2">
                      <h3>Items by Group — {fromDate} → {toDate}</h3>
                      {rows.length > 0 && (
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" onClick={handleIBGCsv}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
                          <Button variant="outline" size="sm" onClick={handleIBGPdf}><FileText className="h-3.5 w-3.5 mr-1" /> PDF</Button>
                        </div>
                      )}
                    </div>
                    {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
                    {rows.length === 0 && !loading ? (
                      <p className="text-sm text-slate-500">No sales in this date range.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left border-b border-slate-200 text-slate-600">
                              <th className="py-2 pr-3">Item Group</th>
                              <th className="py-2 pr-3 text-right">Items Count</th>
                              <th className="py-2 pr-3 text-right">Total Quantity</th>
                              <th className="py-2 pr-3 text-right">Total Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r, i) => (
                              <tr key={r.groupId ?? i} className="border-b border-slate-100">
                                <td className="py-2 pr-3 font-semibold">{r.groupName}</td>
                                <td className="py-2 pr-3 text-right font-mono">{r.itemCount}</td>
                                <td className="py-2 pr-3 text-right font-mono">{Number(r.totalQuantity).toFixed(2)}</td>
                                <td className="py-2 pr-3 text-right font-mono font-bold">{fmt(r.totalAmount)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                              <td className="py-2 pr-3">Total</td>
                              <td className="py-2 pr-3 text-right font-mono">{grandTotalItems}</td>
                              <td className="py-2 pr-3 text-right font-mono">{grandTotalQty.toFixed(2)}</td>
                              <td className="py-2 pr-3 text-right font-mono">{fmt(grandTotalAmt)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              );
            };

            /* ============== Order Reports ============== */

const OrderReportView: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
  orderType: string | undefined; setOrderType: (v: string | undefined) => void;
  rows: OrderReportRow[];
  loading: boolean;
}> = ({ fromDate, setFromDate, toDate, setToDate, orderType, setOrderType, rows, loading }) => {
  const totalAmount = rows.reduce((s, r) => s + Number(r.totalAmount), 0);
  const orderCsvHeaders = ['Order No', 'Date', 'Time', 'Table', 'Waiter', 'Customer', 'Status', 'Total'];
  const handleOrderCSV = () => {
    const data = rows.map((r) => [
      r.orderNumber, new Date(r.date).toLocaleDateString(), r.time || new Date(r.date).toLocaleTimeString(),
      r.tableName ?? '—', r.waiterName ?? '—', r.customerName ?? '—', r.status,
      String(Number(r.totalAmount).toFixed(2)),
    ]);
    exportCSV(`order-report-${fromDate}-${toDate}.csv`, orderCsvHeaders, data);
  };
  const handleOrderPDF = () => {
    const data = rows.map((r) => [
      r.orderNumber, new Date(r.date).toLocaleDateString(), r.time || new Date(r.date).toLocaleTimeString(),
      r.tableName ?? '—', r.waiterName ?? '—', r.customerName ?? '—', r.status,
      fmt(r.totalAmount),
    ]);
    exportPDF(`order-report-${fromDate}-${toDate}.pdf`, `Order Report — ${fromDate} → ${toDate}`, orderCsvHeaders, data);
  };
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div>
          <Label>From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <OrderTypeSelect value={orderType} onChange={setOrderType} />
      </div>
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />

      <div className="pos-report-card">
        <div className="flex items-center justify-between mb-2">
          <h3>Order Reports — {fromDate} → {toDate}</h3>
          {rows.length > 0 && (
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={handleOrderCSV}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={handleOrderPDF}><FileText className="h-3.5 w-3.5 mr-1" /> PDF</Button>
            </div>
          )}
        </div>
        {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {rows.length === 0 && !loading ? (
          <p className="text-sm text-slate-500">No orders in this date range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200 text-slate-600">
                  <th className="py-2 pr-3">Order No</th>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Table</th>
                  <th className="py-2 pr-3">Waiter</th>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-mono text-sm">{r.orderNumber}</td>
                    <td className="py-2 pr-3 text-sm">{new Date(r.date).toLocaleDateString()}</td>
                    <td className="py-2 pr-3 text-sm">{r.time || new Date(r.date).toLocaleTimeString()}</td>
                    <td className="py-2 pr-3 text-sm">{r.tableName ?? '—'}</td>
                    <td className="py-2 pr-3 text-sm">{r.waiterName ?? '—'}</td>
                    <td className="py-2 pr-3 text-sm">{r.customerName ?? '—'}</td>
                    <td className="py-2 pr-3 text-sm capitalize">{r.status}</td>
                    <td className="py-2 pr-3 text-right font-mono font-bold">{fmt(r.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                  <td className="py-2 pr-3" colSpan={7}>Total ({rows.length} orders)</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/* ============== Items Report ============== */

const ItemsReportView: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
  categoryId: string | undefined; setCategoryId: (id: string | undefined) => void;
  orderType: string | undefined; setOrderType: (v: string | undefined) => void;
  categories: Array<{ id: string; name: string }>;
  items: SoldItem[];
  loading: boolean;
}> = ({ fromDate, setFromDate, toDate, setToDate, categoryId, setCategoryId, orderType, setOrderType, categories, items, loading }) => {
  const grandTotal = items.reduce((s, i) => s + Number(i.totalAmount), 0);
  const itemsCsvHeaders = ['Order #', 'Invoice #', 'Sale Date', 'Time', 'Item', 'Category', 'Unit Price', 'Discount %', 'Qty', 'Total Amount', 'Waiter'];
  const handleItemsCSV = () => {
    const data = items.map((it) => [
      it.orderNumber, it.invoiceNumber, new Date(it.saleDate).toLocaleDateString(), it.time || new Date(it.saleDate).toLocaleTimeString(),
      it.item, it.categoryName ?? '—', String(Number(it.unitPrice).toFixed(2)),
      it.discountPercent, String(Number(it.quantity).toFixed(2)),
      String(Number(it.totalAmount).toFixed(2)), it.waiterName ?? '—',
    ]);
    exportCSV(`items-report-${fromDate}-${toDate}.csv`, itemsCsvHeaders, data);
  };
  const handleItemsPDF = () => {
    const data = items.map((it) => [
      it.orderNumber, it.invoiceNumber, new Date(it.saleDate).toLocaleDateString(), it.time || new Date(it.saleDate).toLocaleTimeString(),
      it.item, it.categoryName ?? '—', fmt(it.unitPrice),
      `${it.discountPercent}%`, String(Number(it.quantity).toFixed(2)),
      fmt(it.totalAmount), it.waiterName ?? '—',
    ]);
    exportPDF(`items-report-${fromDate}-${toDate}.pdf`, `Items Report — ${fromDate} → ${toDate}`, itemsCsvHeaders, data);
  };
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div>
          <Label>From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div>
          <Label>Category</Label>
          <select
            className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm"
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value || undefined)}
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <OrderTypeSelect value={orderType} onChange={setOrderType} />
      </div>
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />

      <div className="pos-report-card">
        <div className="flex items-center justify-between mb-2">
          <h3>Items Report — {fromDate} → {toDate}</h3>
          {items.length > 0 && (
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={handleItemsCSV}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={handleItemsPDF}><FileText className="h-3.5 w-3.5 mr-1" /> PDF</Button>
            </div>
          )}
        </div>
        {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {items.length === 0 && !loading ? (
          <p className="text-sm text-slate-500">No sales in this date range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200 text-slate-600">
                  <th className="py-2 pr-3">Order #</th>
                  <th className="py-2 pr-3">Invoice #</th>
                  <th className="py-2 pr-3">Sale Date</th>
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3 text-right">Unit Price</th>
                  <th className="py-2 pr-3 text-right">Discount %</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3 text-right">Total Amount</th>
                  <th className="py-2 pr-3">Waiter</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-mono text-sm">{it.orderNumber}</td>
                    <td className="py-2 pr-3 font-mono text-sm">{it.invoiceNumber}</td>
                    <td className="py-2 pr-3 text-sm">{new Date(it.saleDate).toLocaleDateString()}</td>
                    <td className="py-2 pr-3 text-sm">{it.time || new Date(it.saleDate).toLocaleTimeString()}</td>
                    <td className="py-2 pr-3 font-semibold">{it.item}</td>
                    <td className="py-2 pr-3 text-sm text-slate-500">{it.categoryName ?? '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmt(it.unitPrice)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{it.discountPercent}%</td>
                    <td className="py-2 pr-3 text-right font-mono">{it.quantity}</td>
                    <td className="py-2 pr-3 text-right font-mono font-bold">{fmt(it.totalAmount)}</td>
                    <td className="py-2 pr-3 text-sm">{it.waiterName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                  <td className="py-2 pr-3" colSpan={8}>Total</td>
                  <td className="py-2 pr-3 text-right font-mono">
                    {items.reduce((s, i) => s + Number(i.quantity), 0).toFixed(2)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(grandTotal)}</td>
                  <td className="py-2 pr-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/* ============== Daily / Weekly / Monthly Sales Summary ============== */

const MethodBar: React.FC<{ byMethod: SalesSummaryReport['byMethod'] }> = ({ byMethod }) => {
  const max = Math.max(1, ...byMethod.map((m) => Number(m.total)));
  return (
    <div className="pos-report-card">
      <h3>By payment method</h3>
      {byMethod.length === 0 ? (
        <p className="text-sm text-slate-500">No sales in this period.</p>
      ) : (
        <div>
          {byMethod.map((m) => (
            <div key={m.method} className="pos-report-bar-row">
              <div className="pos-report-bar-label">{m.method}</div>
              <div className="pos-report-bar-track">
                <div className="pos-report-bar-fill" style={{ width: `${(Number(m.total) / max) * 100}%` }} />
              </div>
              <div className="pos-report-bar-value">{fmt(m.total)} ({m.count})</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const PeriodTable: React.FC<{
  periods: SalesSummaryReport['periods'];
  periodLabel?: string;
  fromDate?: string;
  toDate?: string;
}> = ({ periods, periodLabel = 'Period', fromDate = '', toDate = '' }) => {
  const grandTotal = periods.reduce((s, p) => s + Number(p.revenue), 0);
  const periodCsvHeaders = [periodLabel, 'Orders', 'Revenue', 'Avg', 'Discounts', '%'];
  const handlePeriodCSV = () => {
    const data = periods.map((p) => [
      p.periodKey, String(p.orders), String(Number(p.revenue).toFixed(2)),
      String(Number(p.avgOrderValue).toFixed(2)), String(Number(p.discounts).toFixed(2)),
      grandTotal > 0 ? ((Number(p.revenue) / grandTotal) * 100).toFixed(1) + '%' : '—',
    ]);
    const suffix = fromDate ? `-${fromDate}-${toDate}` : '';
    exportCSV(`${periodLabel.toLowerCase()}-breakdown${suffix}.csv`, periodCsvHeaders, data);
  };
  const handlePeriodPDF = () => {
    const data = periods.map((p) => [
      p.periodKey, String(p.orders), fmt(p.revenue), fmt(p.avgOrderValue),
      fmt(p.discounts), grandTotal > 0 ? ((Number(p.revenue) / grandTotal) * 100).toFixed(1) + '%' : '—',
    ]);
    const suffix = fromDate ? ` — ${fromDate} → ${toDate}` : '';
    exportPDF(
      `${periodLabel.toLowerCase()}-breakdown${fromDate ? `-${fromDate}-${toDate}` : ''}.pdf`,
      `${periodLabel} breakdown${suffix}`, periodCsvHeaders, data,
    );
  };
  return (
    <div className="pos-report-card">
      <div className="flex items-center justify-between mb-2">
        <h3>{periodLabel} breakdown</h3>
        {periods.length > 0 && (
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={handlePeriodCSV}><Download className="h-3.5 w-3.5 mr-1" /> CSV</Button>
            <Button variant="outline" size="sm" onClick={handlePeriodPDF}><FileText className="h-3.5 w-3.5 mr-1" /> PDF</Button>
          </div>
        )}
      </div>
      {periods.length === 0 ? (
        <p className="text-sm text-slate-500">No sales in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-200 text-slate-600">
                <th className="py-2 pr-3">{periodLabel}</th>
                <th className="py-2 pr-3 text-right">Orders</th>
                <th className="py-2 pr-3 text-right">Revenue</th>
                <th className="py-2 pr-3 text-right">Avg</th>
                <th className="py-2 pr-3 text-right">Discounts</th>
                <th className="py-2 pr-3 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.periodKey} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-semibold">{p.periodKey}</td>
                  <td className="py-2 pr-3 text-right font-mono">{p.orders}</td>
                  <td className="py-2 pr-3 text-right font-mono font-bold">{fmt(p.revenue)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(p.avgOrderValue)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{fmt(p.discounts)}</td>
                  <td className="py-2 pr-3 text-right font-mono">
                    {grandTotal > 0 ? `${((Number(p.revenue) / grandTotal) * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const DailySalesView: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
  report: SalesSummaryReport | undefined;
  loading: boolean;
}> = ({ fromDate, setFromDate, toDate, setToDate, report, loading }) => {
  const t = report?.totals;
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div>
          <Label>From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        {t && (
          <div className="pos-shift-banner">
            <BarChart3 className="h-3.5 w-3.5" /> {t.orders} order{t.orders === 1 ? '' : 's'} · {fmt(t.revenue)}
          </div>
        )}
      </div>
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
      {loading ? (
        <div className="text-slate-500 p-4">Loading daily sales…</div>
      ) : !report ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">
          <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p className="font-semibold">No data for {fromDate} → {toDate}</p>
        </div>
      ) : (
        <>
          <div className="pos-report-grid">
            <ReportCard title="Net revenue" value={fmt(t!.revenue)} sub={`ex-tax · ${t!.orders} order${t!.orders === 1 ? '' : 's'}`} accent />
            <ReportCard title="Gross sales" value={fmt(t!.grossSales)} sub="incl. tax" />
            <ReportCard title="Avg order value" value={fmt(t!.avgOrderValue)} />
            <ReportCard title="Discounts" value={fmt(t!.discounts)} />
            <ReportCard title="Taxes" value={fmt(t!.taxes)} />
            <ReportCard title="Refunds" value={fmt(t!.refunds)} sub={`net sales ${fmt(t!.netSales)}`} />
          </div>
          <PeriodTable periods={report.periods} periodLabel="Day" fromDate={fromDate} toDate={toDate} />
          <MethodBar byMethod={report.byMethod} />
        </>
      )}
    </div>
  );
};

const WeeklySalesView: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
  report: SalesSummaryReport | undefined;
  loading: boolean;
}> = ({ fromDate, setFromDate, toDate, setToDate, report, loading }) => {
  const t = report?.totals;
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div>
          <Label>From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        {t && (
          <div className="pos-shift-banner">
            <BarChart3 className="h-3.5 w-3.5" /> {fromDate} → {toDate} · {t.orders} order{t.orders === 1 ? '' : 's'} · {fmt(t.revenue)}
          </div>
        )}
      </div>
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
      {loading ? (
        <div className="text-slate-500 p-4">Loading weekly sales…</div>
      ) : !report ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">
          <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p className="font-semibold">No data for {fromDate} → {toDate}</p>
        </div>
      ) : (
        <>
          <div className="pos-report-grid">
            <ReportCard title="Net revenue" value={fmt(t!.revenue)} sub={`ex-tax · ${t!.orders} order${t!.orders === 1 ? '' : 's'}`} accent />
            <ReportCard title="Gross sales" value={fmt(t!.grossSales)} sub="incl. tax" />
            <ReportCard title="Avg order value" value={fmt(t!.avgOrderValue)} />
            <ReportCard title="Discounts" value={fmt(t!.discounts)} />
            <ReportCard title="Taxes" value={fmt(t!.taxes)} />
            <ReportCard title="Refunds" value={fmt(t!.refunds)} sub={`net sales ${fmt(t!.netSales)}`} />
          </div>
          <PeriodTable periods={report.periods} periodLabel="Week" fromDate={fromDate} toDate={toDate} />
          <MethodBar byMethod={report.byMethod} />
        </>
      )}
    </div>
  );
};

const MonthlySalesView: React.FC<{
  fromDate: string; setFromDate: (d: string) => void;
  toDate: string; setToDate: (d: string) => void;
  report: SalesSummaryReport | undefined;
  loading: boolean;
}> = ({ fromDate, setFromDate, toDate, setToDate, report, loading }) => {
  const t = report?.totals;
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div>
          <Label>From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        {t && (
          <div className="pos-shift-banner">
            <BarChart3 className="h-3.5 w-3.5" /> {fromDate} → {toDate} · {t.orders} order{t.orders === 1 ? '' : 's'} · {fmt(t.revenue)}
          </div>
        )}
      </div>
      <QuickPresets fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
      {loading ? (
        <div className="text-slate-500 p-4">Loading monthly sales…</div>
      ) : !report ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">
          <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p className="font-semibold">No data for {fromDate} → {toDate}</p>
        </div>
      ) : (
        <>
          <div className="pos-report-grid">
            <ReportCard title="Net revenue" value={fmt(t!.revenue)} sub={`ex-tax · ${t!.orders} order${t!.orders === 1 ? '' : 's'}`} accent />
            <ReportCard title="Gross sales" value={fmt(t!.grossSales)} sub="incl. tax" />
            <ReportCard title="Avg order value" value={fmt(t!.avgOrderValue)} />
            <ReportCard title="Discounts" value={fmt(t!.discounts)} />
            <ReportCard title="Taxes" value={fmt(t!.taxes)} />
            <ReportCard title="Refunds" value={fmt(t!.refunds)} sub={`net sales ${fmt(t!.netSales)}`} />
          </div>
          <PeriodTable periods={report.periods} periodLabel="Month" fromDate={fromDate} toDate={toDate} />
          <MethodBar byMethod={report.byMethod} />
        </>
      )}
    </div>
  );
};

export default ReportsPage;
