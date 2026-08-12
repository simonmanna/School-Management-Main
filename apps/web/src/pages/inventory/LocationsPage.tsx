import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plus, Edit3, Trash2, ChevronLeft, MapPin } from "lucide-react";
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
import { locationsApi, type InventoryLocation } from "@/lib/api/locations";

const LOCATION_TYPES = [
  { value: "warehouse", label: "Warehouse" },
  { value: "store", label: "Store" },
  { value: "virtual", label: "Virtual" },
  { value: "main_kitchen", label: "Main Kitchen" },
  { value: "bar", label: "Bar" },
  { value: "storage_room", label: "Storage Room" },
  { value: "walkin_fridge", label: "Walk-in Fridge" },
  { value: "freezer", label: "Freezer" },
  { value: "dry_storage", label: "Dry Storage" },
  { value: "front_counter", label: "Front Counter" },
  { value: "branch", label: "Branch" },
];

function LocationDialog({
  location,
  onClose,
  onSaved,
}: {
  location?: InventoryLocation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!location;
  const [code, setCode] = useState(location?.code ?? "");
  const [name, setName] = useState(location?.name ?? "");
  const [type, setType] = useState(location?.type ?? "warehouse");
  const [isActive, setIsActive] = useState(location?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!code.trim()) return setError("Code is required");
    if (!name.trim()) return setError("Name is required");
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        await locationsApi.update(location!.id, {
          code: code.trim(),
          name: name.trim(),
          type,
          isActive,
        });
      } else {
        await locationsApi.create({
          code: code.trim(),
          name: name.trim(),
          type,
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
            {isEdit ? `Edit "${location?.name}"` : "New Location"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="text-xs font-bold uppercase text-gray-500">
              Code
            </label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. WH-MAIN"
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase text-gray-500">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main Warehouse"
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase text-gray-500">
              Type
            </label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCATION_TYPES.map((lt) => (
                  <SelectItem key={lt.value} value={lt.value}>
                    {lt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isEdit && (
            <label className="flex items-center justify-between rounded border px-3 py-2 cursor-pointer">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-[11px] text-slate-500">
                  Disabled locations are hidden from stock operations.
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

export default function LocationsPage() {
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{
    open: boolean;
    location?: InventoryLocation | null;
  }>({ open: false });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await locationsApi.list();
      setLocations(res.data);
    } catch (e: any) {
      const msg = e.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(", ") : msg || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (loc: InventoryLocation) => {
    if (!confirm(`Delete "${loc.name}"? This cannot be undone.`)) return;
    try {
      await locationsApi.delete(loc.id);
      load();
    } catch (e: any) {
      alert(e.response?.data?.message || e.message);
    }
  };

  const toggleActive = async (loc: InventoryLocation) => {
    try {
      await locationsApi.update(loc.id, { isActive: !loc.isActive });
      load();
    } catch (e: any) {
      alert(e.response?.data?.message || e.message);
    }
  };

  const typeLabel = (type: string) =>
    LOCATION_TYPES.find((lt) => lt.value === type)?.label ?? type;

  return (
    <div className="p-2 max-w-[1800px] mx-auto space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/inventory"
            className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Back to Inventory
          </Link>
          <h1 className="text-xl font-bold text-slate-800 mt-1">
            Inventory Locations
          </h1>
          <p className="text-sm text-slate-500">
            Manage warehouses, stores, and storage locations.
          </p>
        </div>
        <Button onClick={() => setDialog({ open: true })}>
          <Plus className="w-4 h-4 mr-1" /> New Location
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-5 text-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mx-auto" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Code</th>
                <th className="text-left px-4 py-2 font-semibold">Name</th>
                <th className="text-left px-4 py-2 font-semibold">Type</th>
                <th className="text-center px-4 py-2 font-semibold">Status</th>
                <th className="text-right px-4 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {locations.map((loc) => (
                <tr key={loc.id} className={loc.isActive ? "" : "bg-slate-50/60"}>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                    {loc.code}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-slate-800">
                      {loc.name}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      {typeLabel(loc.type)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => toggleActive(loc)}
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        loc.isActive
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {loc.isActive ? "Active" : "Disabled"}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => setDialog({ open: true, location: loc })}
                      className="p-1.5 text-slate-500 hover:text-[#3c8dbc]"
                      title="Edit"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => remove(loc)}
                      className="p-1.5 text-slate-500 hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {locations.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-slate-400"
                  >
                    No locations yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {dialog.open && (
        <LocationDialog
          location={dialog.location}
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
