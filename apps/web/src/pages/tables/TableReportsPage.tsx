/**
 * Tables — Reports. Three reports in one page:
 *   1. Utilization by hour (today by default).
 *   2. Revenue per table / per zone for a date range.
 *   3. Reservation outcomes for a date range.
 *
 * Charts are inline SVG bars (no extra dependency). The "top performers"
 * table uses shadcn Table.
 */
import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import {
  useReservationReport,
  useRevenueReport,
  useUtilizationReport,
} from '@/features/tables/api';
import { fmtMoney } from '@/features/tables/utils';

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

export const TableReportsPage: React.FC = () => {
  const [utilDate, setUtilDate] = useState(today());
  const [revFrom, setRevFrom] = useState(daysAgo(7));
  const [revTo, setRevTo] = useState(today());
  const [resFrom, setResFrom] = useState(daysAgo(7));
  const [resTo, setResTo] = useState(today());

  const util = useUtilizationReport(utilDate);
  const rev = useRevenueReport(revFrom, revTo);
  const res = useReservationReport(resFrom, resTo);

  return (
    <div className="space-y-6">
      {/* ── Utilization ── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-extrabold">Utilization</h2>
              <p className="text-sm text-slate-500">
                Occupancy % by hour of day. Total active tables:{' '}
                {util.data?.totalActiveTables ?? '—'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={utilDate}
                onChange={(e) => setUtilDate(e.target.value)}
                className="h-9 w-44"
              />
              <Button variant="outline" size="sm" onClick={() => util.refetch()}>
                <RefreshCw className="w-3 h-3 mr-1" /> Refresh
              </Button>
            </div>
          </div>
          <HourBars hours={util.data?.hours ?? []} />
          {util.data?.peakHours?.length ? (
            <p className="mt-3 text-sm text-slate-500">
              Peak hours:{' '}
              {util.data.peakHours
                .map((h) => `${h}:00 (${util.data?.hours.find((x) => x.hour === h)?.occupancyPct ?? 0}%)`)
                .join(', ')}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Revenue ── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-extrabold">Revenue</h2>
              <p className="text-sm text-slate-500">
                Sales per table and per zone for the selected date range.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input type="date" value={revFrom} onChange={(e) => setRevFrom(e.target.value)} className="h-9 w-36" />
              <span className="text-slate-400">–</span>
              <Input type="date" value={revTo} onChange={(e) => setRevTo(e.target.value)} className="h-9 w-36" />
              <Button variant="outline" size="sm" onClick={() => rev.refetch()}>
                <RefreshCw className="w-3 h-3 mr-1" /> Refresh
              </Button>
            </div>
          </div>

          {rev.data ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
              <Kpi label="Orders" value={String(rev.data.totals.orders)} />
              <Kpi label="Revenue" value={fmtMoney(rev.data.totals.revenue)} />
              <Kpi
                label="Avg dining"
                value={`${rev.data.totals.averageDiningMinutes}m`}
              />
            </div>
          ) : null}

          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-2">
            Top performers
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-sm uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <th className="text-left py-2">Table</th>
                <th className="text-left py-2">Zone</th>
                <th className="text-right py-2">Orders</th>
                <th className="text-right py-2">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {(rev.data?.topPerformers ?? []).map((row) => (
                <tr key={row.tableId} className="border-b border-slate-100">
                  <td className="py-2 font-bold">
                    {row.number != null ? `T${row.number}` : '—'} {row.name}
                  </td>
                  <td className="py-2 text-slate-600">
                    {row.zoneName ?? row.zone}
                  </td>
                  <td className="py-2 text-right">{row.orders}</td>
                  <td className="py-2 text-right font-extrabold">
                    {fmtMoney(row.revenue)}
                  </td>
                </tr>
              ))}
              {rev.data && rev.data.topPerformers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-400">
                    No revenue in this range.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ── Reservations ── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-extrabold">Reservations</h2>
              <p className="text-sm text-slate-500">
                Outcome counts and rates for the selected date range.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input type="date" value={resFrom} onChange={(e) => setResFrom(e.target.value)} className="h-9 w-36" />
              <span className="text-slate-400">–</span>
              <Input type="date" value={resTo} onChange={(e) => setResTo(e.target.value)} className="h-9 w-36" />
              <Button variant="outline" size="sm" onClick={() => res.refetch()}>
                <RefreshCw className="w-3 h-3 mr-1" /> Refresh
              </Button>
            </div>
          </div>

          {res.data ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Kpi label="Total" value={String(res.data.totals.total)} />
              <Kpi label="Completed" value={String(res.data.totals.completed)} accent="text-emerald-600" />
              <Kpi label="No-show" value={String(res.data.totals.noShow)} accent="text-orange-600" />
              <Kpi label="Cancelled" value={String(res.data.totals.cancelled)} accent="text-rose-600" />
              <Kpi label="Completion rate" value={`${res.data.totals.completionRate}%`} />
              <Kpi label="No-show rate" value={`${res.data.totals.noShowRate}%`} accent="text-orange-600" />
            </div>
          ) : null}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-sm uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <th className="text-left py-2">Day</th>
                <th className="text-right py-2">Total</th>
                <th className="text-right py-2">Completed</th>
                <th className="text-right py-2">No-show</th>
                <th className="text-right py-2">Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {(res.data?.byDay ?? []).map((row) => (
                <tr key={row.day} className="border-b border-slate-100">
                  <td className="py-2 font-bold">{row.day}</td>
                  <td className="py-2 text-right">{row.total}</td>
                  <td className="py-2 text-right text-emerald-700">{row.completed}</td>
                  <td className="py-2 text-right text-orange-700">{row.noShow}</td>
                  <td className="py-2 text-right text-rose-700">{row.cancelled}</td>
                </tr>
              ))}
              {res.data && res.data.byDay.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">
                    No reservations in this range.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: string; accent?: string }> = ({
  label,
  value,
  accent = 'text-slate-700',
}) => (
  <div>
    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
      {label}
    </div>
    <div className={`text-2xl font-extrabold ${accent} mt-1`}>{value}</div>
  </div>
);

const HourBars: React.FC<{ hours: Array<{ hour: number; occupancyPct: number }> }> = ({
  hours,
}) => {
  const max = useMemo(() => Math.max(1, ...hours.map((h) => h.occupancyPct)), [hours]);
  return (
    <div className="grid grid-cols-12 gap-1">
      {hours.map((h) => (
        <div key={h.hour} className="text-center">
          <div className="h-24 flex items-end justify-center bg-slate-50 rounded">
            <div
              className="w-full rounded-t"
              style={{
                height: `${(h.occupancyPct / max) * 100}%`,
                background:
                  h.occupancyPct >= 75
                    ? '#ef4444'
                    : h.occupancyPct >= 50
                    ? '#f97316'
                    : h.occupancyPct >= 25
                    ? '#eab308'
                    : '#22c55e',
              }}
              title={`${h.hour}:00 — ${h.occupancyPct}%`}
            />
          </div>
          <div className="text-[10px] text-slate-500 mt-1">{h.hour}</div>
        </div>
      ))}
    </div>
  );
};

export default TableReportsPage;