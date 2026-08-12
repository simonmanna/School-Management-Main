import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Receipt,
  Banknote,
  Clock,
  TrendingUp,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, type Column } from "@/components/data-table";
import {
  expenseCategoriesApi,
} from "@/lib/api/expenseCategories";
import { expensesApi } from "@/lib/api/expenses";
import type { Expense, ExpenseStats } from "@/types/expenses";
import { money, date } from "@/lib/format";

interface ExpenseCategory {
  id: string;
  name: string;
  icon?: string | null;
  isActive?: boolean;
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<
    string,
    { label: string; bg: string; text: string; dot: string }
  > = {
    DRAFT: { label: "Draft", bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400" },
    APPROVED: { label: "Approved", bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
    POSTED: { label: "Posted", bg: "bg-indigo-50", text: "text-indigo-700", dot: "bg-indigo-500" },
    REJECTED: { label: "Rejected", bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
    CANCELLED: { label: "Cancelled", bg: "bg-slate-100", text: "text-slate-500", dot: "bg-slate-400" },
    VOID: { label: "Void", bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500" },
    PENDING: { label: "Pending", bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  };
  const c = cfg[status] ?? cfg.DRAFT;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-sm font-semibold ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

function categoryLabel(e: Expense): string {
  const icon = e.category?.icon ?? "🗂️";
  const name = e.categoryName ?? e.category?.name ?? "—";
  return `${icon} ${name}`;
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color = "blue",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color?: "blue" | "amber" | "emerald" | "slate" | "violet" | "rose";
}) {
  const pal = {
    blue: { grad: "from-blue-500 to-blue-600", iconBg: "bg-blue-400/30", sub: "text-blue-100" },
    amber: { grad: "from-amber-500 to-amber-600", iconBg: "bg-amber-400/30", sub: "text-amber-100" },
    emerald: { grad: "from-emerald-500 to-emerald-600", iconBg: "bg-emerald-400/30", sub: "text-emerald-100" },
    slate: { grad: "from-slate-600 to-slate-700", iconBg: "bg-slate-500/30", sub: "text-slate-200" },
    violet: { grad: "from-violet-500 to-violet-600", iconBg: "bg-violet-400/30", sub: "text-violet-100" },
    rose: { grad: "from-rose-500 to-rose-600", iconBg: "bg-rose-400/30", sub: "text-rose-100" },
  }[color];

  return (
    <div className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${pal.grad} p-4 text-white shadow-lg`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-[11px] font-bold uppercase tracking-widest ${pal.sub} mb-1`}>{label}</p>
          <p className="text-lg font-bold leading-tight truncate">{value}</p>
          {sub && <p className={`text-sm mt-0.5 ${pal.sub} opacity-90`}>{sub}</p>}
        </div>
        <div className={`shrink-0 w-9 h-9 ${pal.iconBg} rounded-lg flex items-center justify-center`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full bg-white/5 pointer-events-none" />
    </div>
  );
}

export default function ExpensesReportPage() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [dateFrom, setDateFrom] = useState(monthStart.toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(today.toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [stats, setStats] = useState<ExpenseStats | null>(null);
  const [rows, setRows] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const loadCategories = useCallback(async () => {
    try {
      const all = await expenseCategoriesApi.list();
      setCategories(all.filter((c) => c.isActive));
    } catch {
      /* silent */
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, paged] = await Promise.all([
        expensesApi.getStats(dateFrom || undefined, dateTo || undefined),
        expensesApi.getAll({
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          categoryId: categoryId || undefined,
          page,
          limit: 20,
        }),
      ]);
      setStats(s);
      setRows(paged.data);
      setTotal(paged.total);
    } catch {
      setStats(null);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, categoryId, page]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, categoryId]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const allRows: Expense[] = [];
      let p = 1;
      let hasMore = true;
      while (hasMore) {
        const res = await expensesApi.getAll({
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          categoryId: categoryId || undefined,
          page: p,
          limit: 200,
        });
        allRows.push(...res.data);
        hasMore = allRows.length < res.total;
        p++;
      }

      const header = "Expense Code,Date,Title,Category,Amount,Status,Created By,Paid At,Notes";
      const lines: string[] = [header];
      for (const r of allRows) {
        lines.push([
          r.expenseCode,
          r.expenseDate.slice(0, 10),
          r.title,
          r.categoryName ?? r.category?.name ?? "",
          String(r.amount),
          r.status,
          r.createdBy?.staff ? r.createdBy.staff.firstName : "—",
          r.paidAt ? r.paidAt.slice(0, 10) : "",
          r.notes ?? "",
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
      }

      const csv = lines.join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `expenses-report-${dateFrom}-${dateTo}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to export CSV");
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<Expense>[] = [
    {
      key: "expenseDate",
      header: "Date",
      className: "whitespace-nowrap",
      render: (r) => <span className="font-mono text-sm">{date(r.expenseDate)}</span>,
    },
    {
      key: "expenseCode",
      header: "Code",
      className: "font-mono text-sm text-slate-500",
      render: (r) => r.expenseCode,
    },
    {
      key: "title",
      header: "Title",
      render: (r) => <span className="font-medium text-slate-700">{r.title}</span>,
    },
    {
      key: "category",
      header: "Category",
      render: (r) => <span className="text-sm">{categoryLabel(r)}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      className: "text-right font-mono font-semibold",
      render: (r) => <span className="text-slate-800">{money(r.amount)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "createdBy",
      header: "Created By",
      render: (r) => {
        const n = r.createdBy?.staff
          ? r.createdBy.staff.firstName
          : "—";
        return <span className="text-sm text-slate-500">{n}</span>;
      },
    },
  ];

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="p-2 max-w-[1800px] mx-auto space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/expenses"
            className="text-sm text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Back to Expenses
          </Link>
          <h1 className="text-2xl font-bold text-slate-800 mt-1">Expense Reports</h1>
          <p className="text-sm text-slate-500">
            Filter, summarize, and export your expense history.
          </p>
        </div>
        <Button
          onClick={handleExport}
          disabled={exporting || total === 0}
          className="bg-[#3c8dbc] hover:bg-[#367fa9]"
        >
          {exporting ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <Download className="w-4 h-4 mr-1.5" />
          )}
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-2.5 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">From</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-44 text-sm"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">To</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-44 text-sm"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Category</label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="w-52 text-sm">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ""}{c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <StatCard
          label="Total Expenses"
          value={stats ? money(stats.grandTotal) : "—"}
          sub={`${stats?.count ?? 0} entries`}
          icon={Receipt}
          color="blue"
        />
        <StatCard
          label="Total Paid"
          value={stats ? money(stats.totalPaid) : "—"}
          sub={`${stats?.totalPaidCount ?? 0} paid`}
          icon={Banknote}
          color="emerald"
        />
        <StatCard
          label="Total Unpaid"
          value={stats ? money(stats.totalUnpaid) : "—"}
          sub={`${stats?.totalUnpaidCount ?? 0} unpaid`}
          icon={Clock}
          color="amber"
        />
        <StatCard
          label="Partially Paid"
          value={stats ? money(stats.totalPartiallyPaid) : "—"}
          sub={`${stats?.totalPartiallyPaidCount ?? 0} partial`}
          icon={TrendingUp}
          color="violet"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          emptyMessage="No expenses match the selected filters."
          getRowId={(r) => r.id}
        />

        {/* Pagination */}
        <div className="flex items-center justify-between px-3 py-2.5 border-t border-slate-100">
          <p className="text-sm text-slate-500">
            Showing {total === 0 ? 0 : (page - 1) * 20 + 1}–
            {Math.min(page * 20, total)} of {total}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page <= 1}
              onClick={() => setPage(1)}
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
            <span className="text-sm text-slate-600 px-1.5 font-medium">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page >= totalPages}
              onClick={() => setPage(totalPages)}
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
