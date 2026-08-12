import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  ShieldCheck,
  ShieldAlert,
  Search,
  Check,
  Minus,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useRole, useUpdateRole, usePermissionCatalog } from '@/features/staff/api';
import type { PermissionGroup } from '@/features/staff/types';

/** Prettify a resource key like "production_order" -> "Production Order". */
function prettyResource(resource: string): string {
  return resource
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function RoleEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const roleQuery = useRole(id);
  const catalog = usePermissionCatalog();
  const updateRole = useUpdateRole();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<string[]>([] as string[]);
  const [search, setSearch] = useState('');
  // Collapsed state keyed by resource; default all expanded.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState(false);

  const role = roleQuery.data;
  const groups = catalog.data?.groups ?? [];

  // Initialise form state once the role loads.
  useEffect(() => {
    if (!role) return;
    setName(role.name);
    setDescription(role.description ?? '');
    setPermissions(role.permissions ?? []);
  }, [role]);

  const selectedCount = permissions.length;
  const totalCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.permissions.length, 0),
    [groups],
  );

  const filteredGroups: PermissionGroup[] = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        permissions: g.permissions.filter(
          (p) =>
            p.action.toLowerCase().includes(q) || p.key.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.permissions.length > 0);
  }, [groups, search]);

  const togglePerm = (key: string, on: boolean) => {
    setTouched(true);
    setPermissions((cur) =>
      on ? Array.from(new Set([...cur, key])) : cur.filter((k) => k !== key),
    );
  };

  const toggleGroup = (group: PermissionGroup, on: boolean) => {
    setTouched(true);
    const keys = group.permissions.map((p) => p.key);
    setPermissions((cur) => {
      if (on) return Array.from(new Set([...cur, ...keys]));
      const remove = new Set(keys);
      return cur.filter((k) => !remove.has(k));
    });
  };

  const groupState = (group: PermissionGroup) => {
    const sel = group.permissions.filter((p) => permissions.includes(p.key)).length;
    return { sel, allOn: sel === group.permissions.length, someOn: sel > 0 && sel < group.permissions.length };
  };

  const canSave = name.trim().length >= 2 && selectedCount > 0 && !updateRole.isPending;

  const onSave = async () => {
    if (!id || !canSave) return;
    try {
      await updateRole.mutateAsync({
        id,
        input: { name: name.trim(), description: description.trim() || undefined, permissions },
      });
      navigate('/staff/roles');
    } catch {
      /* error toast handled by mutation */
    }
  };

  if (roleQuery.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (roleQuery.isError || !role) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-destructive">Could not load this role.</p>
        <Button variant="outline" onClick={() => navigate('/staff/roles')}>
          <ArrowLeft className="h-4 w-4" /> Back to Roles
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/staff/roles" className="hover:text-foreground">
          Roles &amp; Permissions
        </Link>
        <span className="opacity-50">/</span>
        <span className="font-medium text-foreground">{role.name}</span>
        <Badge variant="secondary" className="ml-1 text-[10px]">
          Edit
        </Badge>
      </nav>

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate('/staff/roles')} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            {role.isSystem ? (
              <ShieldAlert className="h-5 w-5 text-amber-500" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-primary" />
            )}
            <div>
              <h1 className="text-2xl font-semibold leading-tight">Edit Role</h1>
              <p className="text-sm text-muted-foreground">
                {role.isSystem
                  ? 'Seeded system role — rename, describe, and adjust permissions.'
                  : 'Adjust this role’s name and the permissions it grants.'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/staff/roles')}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!canSave}>
            <Save className="h-4 w-4" /> Save changes
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
        <span className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{role._count?.users ?? 0}</span>
          <span className="text-muted-foreground">{role._count?.users === 1 ? 'user' : 'users'}</span>
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">{selectedCount}</span> of {totalCount} permissions
          selected
        </span>
        {role.isSystem && (
          <Badge variant="secondary" className="text-[10px]">
            System
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        {/* Left: role details */}
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Role Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setTouched(true);
                }}
                placeholder="Cashier"
              />
              {name.trim().length > 0 && name.trim().length < 2 && (
                <p className="text-sm text-destructive">At least 2 characters.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setTouched(true);
                }}
                placeholder="Front-of-house staff"
              />
            </div>
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Selected permissions</span>
                <span className="font-semibold">
                  {selectedCount}/{totalCount}
                </span>
              </div>
              {selectedCount === 0 && (
                <p className="mt-2 text-xs text-destructive">
                  Pick at least one permission to save this role.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right: permission matrix */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Permissions
            </CardTitle>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Filter permissions…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {catalog.isLoading ? (
              <p className="p-5 text-sm text-muted-foreground">Loading permissions…</p>
            ) : (
              <div className="divide-y">
                {filteredGroups.map((group) => {
                  const { sel, allOn, someOn } = groupState(group);
                  const isCollapsed = collapsed[group.resource];
                  return (
                    <div key={group.resource}>
                      {/* Group header with select-all toggle */}
                      <div className="flex items-center justify-between gap-3 px-5 py-3">
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsed((c) => ({ ...c, [group.resource]: !c[group.resource] }))
                          }
                          className="flex flex-1 items-center gap-2 text-left"
                        >
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
                              allOn
                                ? 'border-primary bg-primary text-primary-foreground'
                                : someOn
                                  ? 'border-primary bg-primary/40 text-primary-foreground'
                                  : 'border-input bg-background'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleGroup(group, !allOn);
                            }}
                            role="checkbox"
                            aria-checked={allOn}
                            aria-label={`Select all ${prettyResource(group.resource)}`}
                          >
                            {allOn && <Check className="h-3 w-3" />}
                            {someOn && <Minus className="h-3 w-3" />}
                          </span>
                          <span className="text-sm font-semibold uppercase tracking-wide">
                            {prettyResource(group.resource)}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {sel}/{group.permissions.length}
                          </Badge>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsed((c) => ({ ...c, [group.resource]: !c[group.resource] }))
                          }
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          {isCollapsed ? 'Show' : 'Hide'}
                        </button>
                      </div>

                      {!isCollapsed && (
                        <div className="grid grid-cols-1 gap-x-6 gap-y-1 px-5 pb-4 sm:grid-cols-2">
                          {group.permissions.map((p) => {
                            const on = permissions.includes(p.key);
                            return (
                              <label
                                key={p.key}
                                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
                              >
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-input"
                                  checked={on}
                                  onChange={(e) => togglePerm(p.key, e.target.checked)}
                                />
                                <span className="flex-1">
                                  <span className="block text-sm font-medium leading-tight">
                                    {p.action}
                                  </span>
                                  <span className="block font-mono text-[10px] text-muted-foreground">
                                    {p.key}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredGroups.length === 0 && (
                  <p className="p-5 text-sm text-muted-foreground">
                    No permissions match “{search}”.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {touched && (
        <div className="flex justify-end">
          <Button onClick={onSave} disabled={!canSave}>
            <Save className="h-4 w-4" /> Save changes
          </Button>
        </div>
      )}
    </div>
  );
}
