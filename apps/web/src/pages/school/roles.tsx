import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { PERMISSIONS } from '@erp/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** Flatten the nested PERMISSIONS object into a flat list of permission keys. */
function flattenPermissions(obj: any, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push(v as string);
    else if (typeof v === 'object' && v !== null) out.push(...flattenPermissions(v, key));
  }
  return out;
}

export function SchoolRolesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['school-roles'],
    queryFn: async () => (await api.get('/roles', { params: { pageSize: 200 } })).data,
  });
  const roles = data?.data ?? data ?? [];
  const allPerms = useMemo(() => flattenPermissions(PERMISSIONS), []);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [perms, setPerms] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const selectRole = (role: any) => {
    setActiveId(role.id);
    setPerms(role.permissions ?? []);
  };

  const toggle = (p: string) => {
    setPerms((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  };

  const save = async () => {
    if (!activeId) return;
    setSaving(true);
    try {
      await api.patch(`/roles/${activeId}`, { permissions: perms });
      notify.success('Permissions updated');
      qc.invalidateQueries({ queryKey: ['school-roles'] });
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const activeRole = roles.find((r: any) => r.id === activeId);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Roles &amp; Permissions</h1>
        <p className="text-sm text-muted-foreground">Manage role-based access control.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="space-y-2 p-3">
            <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Roles</p>
            {isLoading && <p className="px-1 py-2 text-sm text-muted-foreground">Loading…</p>}
            {roles.map((r: any) => (
              <button
                key={r.id}
                onClick={() => selectRole(r)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                  r.id === activeId ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted/50'
                }`}
              >
                <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> {r.name}</span>
                {r.isSystem && <Badge className="bg-slate-100 text-slate-500">system</Badge>}
              </button>
            ))}
            {roles.length === 0 && <p className="px-1 py-2 text-sm text-muted-foreground">No roles.</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            {!activeRole ? (
              <p className="text-sm text-muted-foreground">Select a role to edit its permissions.</p>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{activeRole.name}</p>
                    <p className="text-xs text-muted-foreground">{activeRole.description ?? 'No description'}</p>
                  </div>
                  <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save permissions'}</Button>
                </div>
                <div className="grid max-h-[60vh] grid-cols-1 gap-1 overflow-auto md:grid-cols-2">
                  {allPerms.map((p) => (
                    <label key={p} className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm">
                      <input type="checkbox" checked={perms.includes(p)} onChange={() => toggle(p)} />
                      <span className="font-mono text-xs">{p}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
