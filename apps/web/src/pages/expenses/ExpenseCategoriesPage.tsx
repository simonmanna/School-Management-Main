import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Loader2,
  Plus,
  Edit3,
  Trash2,
  ChevronLeft,
  Link2,
  Link2Off,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  expenseCategoriesApi,
  type ExpenseCategory,
} from "@/lib/api/expenseCategories";

const NONE = "__none__";

function CategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category?: ExpenseCategory | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!category;
  const [name, setName] = useState(category?.name ?? "");
  const [icon, setIcon] = useState(category?.icon ?? "");
  const [ledgerAccountId, setLedgerAccountId] = useState(
    category?.ledgerAccountId ?? NONE,
  );
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!name.trim()) return setError("Category name is required");
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        await expenseCategoriesApi.update(category!.id, {
          name: name.trim(),
          icon: icon.trim() || undefined,
          ledgerAccountId: ledgerAccountId === NONE ? undefined : ledgerAccountId,
          isActive,
        });
      } else {
        await expenseCategoriesApi.create({
          name: name.trim(),
          icon: icon.trim() || undefined,
          ledgerAccountId: ledgerAccountId === NONE ? undefined : ledgerAccountId,
        });
      }
      onSaved();
    } catch (e: any) {
      const msg = e.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(", ") : msg || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit "${category?.name}"` : "New Expense Category"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="grid grid-cols-[80px_1fr] gap-3">
            <div>
              <label className="text-xs font-bold uppercase text-gray-500">
                Icon
              </label>
              <Input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="🦷"
                maxLength={4}
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase text-gray-500">
                Name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lab Materials"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold uppercase text-gray-500">
              Linked GL Account (optional)
            </label>
            <Select value={ledgerAccountId} onValueChange={setLedgerAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="No GL account — won't post" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  No GL account — records expense, no journal entry
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-slate-500 mt-1">
              Link an account to post double-entry (DR this account · CR Cash/AP).
              Leave unset to keep this category out of the ledger.
            </p>
          </div>

          {isEdit && (
            <label className="flex items-center justify-between rounded border px-3 py-2 cursor-pointer">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-[11px] text-slate-500">
                  Disabled categories are hidden from new expenses but keep their
                  history.
                </p>
              </div>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4"
              />
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ExpenseCategoriesPage() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{
    open: boolean;
    category?: ExpenseCategory | null;
  }>({ open: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cats = await expenseCategoriesApi.list();
      setCategories(cats);
    } catch (e) {
      console.error("Failed to load categories:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (cat: ExpenseCategory) => {
    if (!confirm(`Delete "${cat.name}"? This cannot be undone.`)) return;
    try {
      await expenseCategoriesApi.delete(cat.id);
      load();
    } catch (e: any) {
      alert(e.response?.data?.message || e.message);
    }
  };

  const toggleActive = async (cat: ExpenseCategory) => {
    try {
      await expenseCategoriesApi.update(cat.id, { isActive: !cat.isActive });
      load();
    } catch (e: any) {
      alert(e.response?.data?.message || e.message);
    }
  };

  return (
    <div className="p-2 max-w-[1800px] mx-auto space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/expenses"
            className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Back to Expenses
          </Link>
          <h1 className="text-xl font-bold text-slate-800 mt-1">
            Expense Categories
          </h1>
          <p className="text-sm text-slate-500">
            Manage categories and their optional accounting links.
          </p>
        </div>
        <Button onClick={() => setDialog({ open: true })}>
          <Plus className="w-4 h-4 mr-1" /> New Category
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-5 text-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mx-auto" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Category</th>
                <th className="text-left px-4 py-2 font-semibold">GL Account</th>
                <th className="text-center px-4 py-2 font-semibold">Status</th>
                <th className="text-right px-4 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categories.map((c) => (
                <tr key={c.id} className={c.isActive ? "" : "bg-slate-50/60"}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-slate-800">
                      {c.icon ? `${c.icon} ` : ""}
                      {c.name}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {c.ledgerAccountId ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <Link2 className="w-3.5 h-3.5" />
                        {c.ledgerAccount?.code ?? c.ledgerAccountId.slice(0, 8)}
                        {c.ledgerAccount?.name
                          ? ` · ${c.ledgerAccount.name}`
                          : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <Link2Off className="w-3.5 h-3.5" /> Not posted
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => toggleActive(c)}
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        c.isActive
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {c.isActive ? "Active" : "Disabled"}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => setDialog({ open: true, category: c })}
                      className="p-1.5 text-slate-500 hover:text-[#3c8dbc]"
                      title="Edit"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => remove(c)}
                      className="p-1.5 text-slate-500 hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-10 text-center text-slate-400"
                  >
                    No categories yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {dialog.open && (
        <CategoryDialog
          category={dialog.category}
          onClose={() => setDialog({ open: false })}
          onSaved={() => {
            setDialog({ open: false });
            load();
          }}
        />
      )}
    </div>
  );
}
