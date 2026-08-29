import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Lock,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/notify';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { DataTable, type Column } from '@/components/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useCreateRole,
  useDeleteRole,
  usePermissionCatalog,
  useRoles,
  useUpdateRole,
} from '@/features/school/rbac/api';
import { useHasPermission } from '@/features/school/rbac/use-has-permission';
import {
  type CatalogPermission,
  type PermissionCatalog,
  type RoleDataScope,
  type SchoolRole,
  DATA_SCOPES,
  dataScopeLabel,
} from '@/features/school/rbac/types';

type DialogMode = 'create' | 'edit' | 'view';

/* ───────────────────────── Permission matrix ───────────────────────── */

interface PermissionMatrixProps {
  catalog: PermissionCatalog;
  selected?: Set<string>;
  disabledKeys?: Set<string>;
  editable?: boolean;
  onToggle?: (key: string) => void;
  filter?: string;
}

export function PermissionMatrix({
  catalog,
  selected = new Set<string>(),
  disabledKeys = new Set<string>(),
  editable = false,
  onToggle,
  filter = '',
}: PermissionMatrixProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedSubs, setCollapsedSubs] = useState<Set<string>>(new Set());
  const f = filter.trim().toLowerCase();

  const subKey = (g: string, s: string) => `${g}::${s}`;

  const filteredGroups = useMemo(() => {
    const q = (s: string) => s.toLowerCase().includes(f);
    return catalog.groups
      .map((g) => ({
        ...g,
        subgroups: g.subgroups
          .map((sg) => ({
            ...sg,
            permissions: sg.permissions.filter(
              (p) => !f || q(p.key) || q(p.label) || q(p.description),
            ),
          }))
          .filter((sg) => sg.permissions.length > 0),
      }))
      .filter((g) => g.subgroups.length > 0);
  }, [catalog, f]);

  if (filteredGroups.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No permissions match “{filter}”.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {filteredGroups.map((g) => {
        const groupCollapsed = collapsedGroups.has(g.group);
        const groupPerms = g.subgroups.flatMap((sg) => sg.permissions);
        const groupSelectable = groupPerms.filter((p) => !disabledKeys.has(p.key));
        const allSelected =
          groupSelectable.length > 0 && groupSelectable.every((p) => selected.has(p.key));
        return (
          <div key={g.group} className="overflow-hidden rounded-lg border bg-muted/30">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() =>
                  setCollapsedGroups((s) => {
                    const n = new Set(s);
                    n.has(g.group) ? n.delete(g.group) : n.add(g.group);
                    return n;
                  })
                }
                className="flex min-w-0 items-center gap-2 text-left text-sm font-semibold"
              >
                {groupCollapsed ? (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{g.group}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {groupPerms.length} permissions
                </span>
              </button>
              {editable && (
                <label
                  className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    disabled={groupSelectable.length === 0}
                    checked={allSelected}
                    onChange={() => {
                      if (allSelected) groupSelectable.forEach((p) => onToggle?.(p.key));
                      else
                        groupSelectable.forEach((p) => {
                          if (!selected.has(p.key)) onToggle?.(p.key);
                        });
                    }}
                  />
                  Select all
                </label>
              )}
            </div>
            {!groupCollapsed && (
              <div className="space-y-2 px-3 pb-3">
                {g.subgroups.map((sg) => {
                  const subCollapsed = collapsedSubs.has(subKey(g.group, sg.subgroup));
                  return (
                    <div key={sg.subgroup} className="rounded-md border bg-card">
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedSubs((s) => {
                            const n = new Set(s);
                            const k = subKey(g.group, sg.subgroup);
                            n.has(k) ? n.delete(k) : n.add(k);
                            return n;
                          })
                        }
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground"
                      >
                        {subCollapsed ? (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                        )}
                        {sg.subgroup}
                        <span className="text-[10px] opacity-70">{sg.permissions.length}</span>
                      </button>
                      {!subCollapsed && (
                        <ul className="divide-y">
                          {sg.permissions.map((p) => (
                            <PermissionRow
                              key={p.key}
                              perm={p}
                              checked={selected.has(p.key)}
                              disabled={disabledKeys.has(p.key)}
                              editable={editable}
                              onToggle={onToggle}
                            />
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PermissionRow({
  perm,
  checked,
  disabled,
  editable,
  onToggle,
}: {
  perm: CatalogPermission;
  checked: boolean;
  disabled: boolean;
  editable: boolean;
  onToggle?: (key: string) => void;
}) {
  return (
    <li className={cn('flex items-start gap-3 px-3 py-2 text-sm', disabled && 'opacity-60')}>
      {editable ? (
        <input
          type="checkbox"
          className="mt-0.5"
          checked={checked}
          disabled={disabled}
          onChange={() => onToggle?.(perm.key)}
        />
      ) : checked ? (
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      ) : (
        <span className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{perm.label}</span>
          {perm.risk === 'high' && (
            <Badge className="border-amber-300 bg-amber-50 text-[10px] font-medium text-amber-700">
              <AlertTriangle className="mr-1 h-3 w-3" /> High risk
            </Badge>
          )}
          {disabled && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Lock className="h-3 w-3" /> not granted to you
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{perm.description}</p>
        <p className="font-mono text-[10px] text-muted-foreground/70">{perm.key}</p>
      </div>
    </li>
  );
}

/* ───────────────────────── Role create / edit / view dialog ───────────────────────── */

interface RoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: SchoolRole | null;
  mode: DialogMode;
  catalog?: PermissionCatalog;
  canEdit: boolean;
  userPermissions: string[];
  onSwitchMode: (mode: DialogMode) => void;
}

export function RoleDialog({
  open,
  onOpenChange,
  role,
  mode,
  catalog,
  canEdit,
  userPermissions,
  onSwitchMode,
}: RoleDialogProps) {
  const isCreate = mode === 'create';
  const readOnly = mode === 'view' || !canEdit;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dataScope, setDataScope] = useState<RoleDataScope>('school');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');

  const create = useCreateRole();
  const update = useUpdateRole();

  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    setDataScope((role?.dataScope as RoleDataScope) ?? 'school');
    setSelected(new Set(role?.permissions ?? []));
    setFilter('');
  }, [open, role]);

  const disabledKeys = useMemo(() => {
    const s = new Set<string>();
    if (!catalog) return s;
    for (const g of catalog.groups)
      for (const sg of g.subgroups)
        for (const p of sg.permissions)
          if (!userPermissions.includes(p.key)) s.add(p.key);
    return s;
  }, [catalog, userPermissions]);

  const toggle = (key: string) => {
    if (disabledKeys.has(key)) return;
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };

  const saving = create.isPending || update.isPending;

  const submit = async () => {
    if (!name.trim()) {
      notify.error('Name is required');
      return;
    }
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      permissions: [...selected],
      dataScope,
    };
    try {
      if (isCreate) await create.mutateAsync(payload);
      else if (role) await update.mutateAsync({ id: role.id, input: payload });
      onOpenChange(false);
    } catch {
      // The mutation's onError already surfaced a toast (e.g. 403 segregation-of-duties).
    }
  };

  const title = isCreate ? 'New role' : readOnly ? 'Role detail' : 'Edit role';
  const subtitle = isCreate
    ? 'Define a role: pick its permissions and how widely they apply (data scope).'
    : `${role?.name ?? ''} — ${dataScopeLabel(role?.dataScope)} scope`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={name}
                disabled={readOnly}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Class Teacher"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-scope">Data scope</Label>
              <Select
                value={dataScope}
                disabled={readOnly}
                onValueChange={(v) => setDataScope(v as RoleDataScope)}
              >
                <SelectTrigger id="role-scope">
                  <SelectValue placeholder="Select data scope" />
                </SelectTrigger>
                <SelectContent>
                  {DATA_SCOPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {DATA_SCOPES.find((s) => s.value === dataScope)?.description}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="role-desc">Description</Label>
            <Textarea
              id="role-desc"
              value={description}
              disabled={readOnly}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this role for?"
              rows={2}
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Permission matrix</Label>
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Filter permissions…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
            </div>
            {!catalog ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : (
              <div className="max-h-[42vh] overflow-y-auto pr-1">
                <PermissionMatrix
                  catalog={catalog}
                  selected={selected}
                  disabledKeys={disabledKeys}
                  editable={!readOnly}
                  onToggle={toggle}
                  filter={filter}
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          {readOnly ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {canEdit && (
                <Button onClick={() => onSwitchMode('edit')}>
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={saving}>
                {saving ? 'Saving…' : isCreate ? 'Create role' : 'Save changes'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── Roles tab ───────────────────────── */

function RolesTab({ catalog }: { catalog?: PermissionCatalog }) {
  const roles = useRoles();
  const del = useDeleteRole();
  const userPermissions = useAuthStore((s) => s.permissions);
  const [deleting, setDeleting] = useState<SchoolRole | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; role: SchoolRole | null; mode: DialogMode }>({
    open: false,
    role: null,
    mode: 'create',
  });

  const canCreate = useHasPermission(PERMISSIONS.role.create);
  const canUpdate = useHasPermission(PERMISSIONS.role.update);
  const canDelete = useHasPermission(PERMISSIONS.role.delete);

  const data = roles.data ?? [];
  const openCreate = () => setDialog({ open: true, role: null, mode: 'create' });
  const openView = (r: SchoolRole) => setDialog({ open: true, role: r, mode: 'view' });
  const openEdit = (r: SchoolRole) => setDialog({ open: true, role: r, mode: 'edit' });

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      setDeleting(null);
    } catch {
      /* error toast handled by mutation */
    }
  };

  const columns: Column<SchoolRole>[] = [
    {
      key: 'name',
      header: 'Role',
      render: (r) => (
        <button
          type="button"
          onClick={() => openView(r)}
          className="flex items-center gap-2 text-left hover:underline"
        >
          <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            <span className="block font-medium">{r.name}</span>
            {r.description && (
              <span className="block text-xs text-muted-foreground">{r.description}</span>
            )}
          </span>
          {r.isSystem && (
            <Badge variant="secondary" className="text-[10px]">
              System
            </Badge>
          )}
        </button>
      ),
    },
    {
      key: 'dataScope',
      header: 'Data scope',
      render: (r) => (
        <Badge variant="outline" className="font-medium">
          {dataScopeLabel(r.dataScope)}
        </Badge>
      ),
    },
    {
      key: 'permissions',
      header: 'Permissions',
      render: (r) => (
        <Badge variant="outline" className="font-mono">
          {r.permissions.length} keys
        </Badge>
      ),
    },
    {
      key: 'users',
      header: 'Users',
      render: (r) => r._count?.users ?? '—',
    },
    {
      key: 'actions',
      header: '',
      className: 'w-32',
      render: (r) => (
        <div className="flex justify-end gap-1">
          {canUpdate && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => openEdit(r)}
              aria-label="Edit role"
              title="Edit role"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDeleting(r)}
              aria-label="Delete role"
              title="Delete role"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Roles</h2>
          <p className="text-sm text-muted-foreground">
            {data.length} role{data.length === 1 ? '' : 's'} defined for this organization.
          </p>
        </div>
        {canCreate && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New Role
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={data}
            loading={roles.isLoading}
            getRowId={(r) => r.id}
            emptyMessage="No roles yet — create one to get started."
          />
        </CardContent>
      </Card>

      <RoleDialog
        open={dialog.open}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
        role={dialog.role}
        mode={dialog.mode}
        catalog={catalog}
        canEdit={canUpdate}
        userPermissions={userPermissions}
        onSwitchMode={(m) => setDialog((d) => ({ ...d, mode: m }))}
      />

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete role?</DialogTitle>
            <DialogDescription>
              {deleting
                ? `“${deleting.name}” will be removed. Users with this role will lose its permissions on their next request.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={del.isPending} onClick={confirmDelete}>
              {del.isPending ? 'Deleting…' : 'Delete role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───────────────────────── Catalog tab (read-only) ───────────────────────── */

function CatalogTab({ catalog }: { catalog?: PermissionCatalog }) {
  const [filter, setFilter] = useState('');
  const total = useMemo(
    () =>
      catalog?.groups.reduce(
        (acc, g) => acc + g.subgroups.reduce((a, sg) => a + sg.permissions.length, 0),
        0,
      ) ?? 0,
    [catalog],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Permission catalog</h2>
          <p className="text-sm text-muted-foreground">
            Every permission available in this organization ({total} keys), grouped by area.
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Filter permissions…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      {!catalog ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <Card>
          <CardContent className="p-4">
            <PermissionMatrix catalog={catalog} filter={filter} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ───────────────────────── Page ───────────────────────── */

export function SchoolRolesPage() {
  const catalog = usePermissionCatalog();
  const canRead = useHasPermission(PERMISSIONS.role.read);
  const roles = useRoles();
  const rolesCount = roles.data?.length ?? 0;

  if (!canRead) {
    return (
      <div className="space-y-4 p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold">Roles &amp; Permissions</h1>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <Lock className="h-8 w-8 opacity-30" />
            <p className="font-medium">You don’t have permission to view roles.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>School</span>
              <ChevronRight className="h-3 w-3" />
              <span>Administration</span>
              <ChevronRight className="h-3 w-3" />
              <span>Roles &amp; Permissions</span>
            </div>
            <h1 className="text-2xl font-semibold leading-tight">Roles &amp; Permissions</h1>
          </div>
          <Badge variant="secondary" className="ml-1">
            {rolesCount} roles
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="roles">
        <TabsList>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="catalog">Permission Catalog</TabsTrigger>
        </TabsList>
        <TabsContent value="roles">
          <RolesTab catalog={catalog.data} />
        </TabsContent>
        <TabsContent value="catalog">
          <CatalogTab catalog={catalog.data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
