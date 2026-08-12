import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, SlidersHorizontal, Landmark } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

/**
 * Registry-driven configuration, rendered from GET /settings/effective. Each row
 * shows the effective org-level value and the level it resolved from; editing
 * writes the org-level override via PUT /settings/:key. Warehouse/category/product
 * overrides use the same endpoint with a scopeType/scopeId (added in later UI work).
 */

type SettingType = 'bool' | 'enum' | 'string' | 'number' | 'json';

interface EffectiveSetting {
  key: string;
  label: string;
  description: string | null;
  type: SettingType;
  enumValues: string[] | null;
  cascades: boolean;
  scopeLevels: string[];
  value: unknown;
  source: string;
  scopeId: string | null;
}

function SettingRow({
  s,
  value,
  onChange,
}: {
  s: EffectiveSetting;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{s.label}</span>
          {s.source === 'default' && (
            <Badge variant="outline" className="text-[10px]">default</Badge>
          )}
          {s.cascades && (
            <Badge variant="secondary" className="text-[10px]">cascades</Badge>
          )}
        </div>
        {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
      </div>
      <div className="w-full shrink-0 sm:w-64">
        {s.type === 'bool' ? (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="rounded"
              checked={!!value}
              onChange={(e) => onChange(e.target.checked)}
            />
            {value ? 'Enabled' : 'Disabled'}
          </label>
        ) : s.type === 'enum' ? (
          <Select value={value == null ? '' : String(value)} onValueChange={onChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {s.enumValues?.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            type={s.type === 'number' ? 'number' : 'text'}
            value={value == null ? '' : String(value)}
            onChange={(e) =>
              onChange(s.type === 'number' ? Number(e.target.value) : e.target.value)
            }
          />
        )}
      </div>
    </div>
  );
}

export function GroupCard({
  group,
  title,
  description,
  icon,
}: {
  group: 'inventory' | 'accounting' | 'purchasing';
  title: string;
  description: string;
  icon: ReactNode;
}) {
  const qc = useQueryClient();
  const q = useQuery<EffectiveSetting[]>({
    queryKey: ['settings-effective', group],
    queryFn: async () =>
      (await api.get<EffectiveSetting[]>(`/settings/effective?group=${group}`)).data,
  });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (q.data) {
      setValues(Object.fromEntries(q.data.map((s) => [s.key, s.value])));
      setDirty(new Set());
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      for (const key of dirty) {
        await api.put(`/settings/${key}`, { value: values[key] });
      }
    },
    onSuccess: () => {
      notify.success(`${title} saved`);
      qc.invalidateQueries({ queryKey: ['settings-effective', group] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  const setVal = (key: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setDirty((prev) => new Set(prev).add(key));
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (q.data?.length ?? 0) === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">No configurable settings here yet.</p>
        ) : (
          <div className="divide-y">
            {q.data?.map((s) => (
              <SettingRow key={s.key} s={s} value={values[s.key]} onChange={(v) => setVal(s.key, v)} />
            ))}
            <div className="pt-3">
              <Button onClick={() => save.mutate()} disabled={dirty.size === 0 || save.isPending}>
                {save.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save{dirty.size > 0 ? ` (${dirty.size})` : ''}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SystemConfigSection() {
  return (
    <>
      <GroupCard
        group="inventory"
        title="Inventory Configuration"
        description="Org-level defaults. Cascading settings can also be overridden per warehouse, category, or product."
        icon={<SlidersHorizontal className="h-4 w-4 text-muted-foreground" />}
      />
      <GroupCard
        group="accounting"
        title="Accounting Configuration"
        description="Organization-wide accounting behaviour."
        icon={<Landmark className="h-4 w-4 text-muted-foreground" />}
      />
    </>
  );
}
