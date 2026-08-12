import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, ShieldCheck, Search } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/data-table';
import { useAuthStore } from '@/stores/auth.store';
import { useDeleteRole, useRoles } from '@/features/staff/api';
import type { Role } from '@/features/staff/types';
import { RoleDialog } from './RoleDialog';

export function RolesPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);

  const navigate = useNavigate();

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.role.create);
  const canUpdate = hasPermission(PERMISSIONS.role.update);
  const canDelete = hasPermission(PERMISSIONS.role.delete);

  const roles = useRoles();
  const deleteRole = useDeleteRole();

  const allRoles = roles.data ?? [];
  const filtered = search
    ? allRoles.filter(
        (r) =>
          r.name.toLowerCase().includes(search.toLowerCase()) ||
          (r.description ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : allRoles;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (r: Role) => {
    navigate(`/staff/roles/${r.id}/edit`);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRole.mutateAsync(deleting.id);
      setDeleting(null);
    } catch {
      /* error toast in mutation */
    }
  };

  const columns: Column<Role>[] = [
    {
      key: 'name',
      header: 'Role',
      render: (r) => (
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{r.name}</span>
            {r.isSystem && (
              <Badge variant="secondary" className="text-[10px]">
                System
              </Badge>
            )}
          </div>
          {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
        </div>
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
      className: 'w-32 text-right',
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            disabled={!canUpdate}
            onClick={() => openEdit(r)}
            aria-label="Edit role"
            title="Edit role"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!canDelete}
            onClick={() => setDeleting(r)}
            aria-label="Delete role"
            title="Delete role"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Roles &amp; Permissions</h1>
          <p className="text-sm text-muted-foreground">
            Manage who can do what. System roles are seeded with defaults but can be edited or deleted.
          </p>
        </div>
        {canCreate && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New Role
          </Button>
        )}
      </div>

      <Card className="p-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search roles..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSearch(searchInput.trim());
            }}
          />
        </div>
      </Card>

      <DataTable
        columns={columns}
        data={filtered}
        loading={roles.isLoading}
        getRowId={(r) => r.id}
        emptyMessage={search ? 'No roles match your search.' : 'No roles yet — create one to get started.'}
      />

      <RoleDialog open={dialogOpen} onOpenChange={setDialogOpen} role={editing} />

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete role?</DialogTitle>
            <DialogDescription>
              {deleting
                ? `"${deleting.name}" will be removed. Users with this role will lose its permissions on their next request.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleteRole.isPending} onClick={confirmDelete}>
              {deleteRole.isPending ? 'Deleting…' : 'Delete role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
