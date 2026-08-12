import { useEffect, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  KeyRound,
  Lock,
  Unlock,
  Search,
  Users as UsersIcon,
} from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useAuthStore } from '@/stores/auth.store';
import {
  useDeleteUser,
  useResetUserPassword,
  useUnlockUser,
  useUsers,
} from '@/features/staff/api';
import type { UserSummary } from '@/features/staff/types';
import { UserDialog } from './UserDialog';

export function StaffPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [deleting, setDeleting] = useState<UserSummary | null>(null);
  const [resetTarget, setResetTarget] = useState<UserSummary | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const auth = useAuthStore();
  const meId = auth.user?.id;

  const canCreate = auth.hasPermission(PERMISSIONS.user.create);
  const canUpdate = auth.hasPermission(PERMISSIONS.user.update);
  const canDelete = auth.hasPermission(PERMISSIONS.user.delete);

  const users = useUsers({ page, pageSize: 10, search: search || undefined });
  const deleteUser = useDeleteUser();
  const resetUser = useResetUserPassword();
  const unlockUser = useUnlockUser();

  useEffect(() => setPage(1), [search]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (u: UserSummary) => {
    setEditing(u);
    setDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteUser.mutateAsync(deleting.id);
      setDeleting(null);
    } catch {
      /* toast in mutation */
    }
  };

  const confirmReset = async () => {
    if (!resetTarget || resetPassword.length < 10) return;
    try {
      await resetUser.mutateAsync({ id: resetTarget.id, input: { newPassword: resetPassword } });
      setResetTarget(null);
      setResetPassword('');
    } catch {
      /* toast in mutation */
    }
  };

  const doUnlock = async (u: UserSummary) => {
    try {
      await unlockUser.mutateAsync(u.id);
    } catch {
      /* toast in mutation */
    }
  };

  const columns: Column<UserSummary>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (u) => (
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">
              {u.firstName}
            </span>
            {u.id === meId && (
              <Badge variant="outline" className="text-[10px]">
                You
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{u.email}</span>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (u) => (
        <div className="flex flex-wrap gap-1">
          {u.roles.length === 0 && <span className="text-xs text-muted-foreground">No roles</span>}
          {u.roles.map((r) => (
            <Badge key={r.id} variant="secondary" className="text-[10px]">
              {r.name}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (u) => {
        const locked = u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now();
        if (!u.isActive) return <Badge variant="secondary">Disabled</Badge>;
        if (locked) {
          return (
            <Badge variant="destructive" className="gap-1">
              <Lock className="h-3 w-3" /> Locked
            </Badge>
          );
        }
        return <Badge variant="default">Active</Badge>;
      },
    },
    {
      key: 'mfa',
      header: 'MFA',
      render: (u) =>
        u.mfaEnrolled ? (
          <Badge variant="outline" className="text-[10px]">
            On
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Off</span>
        ),
    },
    {
      key: 'lastLogin',
      header: 'Last login',
      render: (u) =>
        u.lastLoginAt ? (
          <span className="text-xs">{new Date(u.lastLoginAt).toLocaleString()}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Never</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-44 text-right',
      render: (u) => {
        const locked = u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now();
        return (
          <div className="flex justify-end gap-1">
            {canUpdate && locked && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => doUnlock(u)}
                aria-label="Unlock account"
                title="Unlock account"
              >
                <Unlock className="h-4 w-4 text-amber-500" />
              </Button>
            )}
            {canUpdate && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setResetTarget(u)}
                aria-label="Reset password"
                title="Reset password"
              >
                <KeyRound className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              disabled={!canUpdate}
              onClick={() => openEdit(u)}
              aria-label="Edit user"
              title="Edit user"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!canDelete || u.id === meId}
              onClick={() => setDeleting(u)}
              aria-label="Delete user"
              title={u.id === meId ? 'You cannot delete your own account' : 'Delete user'}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        );
      },
    },
  ];

  const meta = users.data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <UsersIcon className="h-6 w-6" /> Staff
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage user accounts, role assignments, and password resets.
          </p>
        </div>
        {canCreate && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New User
          </Button>
        )}
      </div>

      <Card className="p-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name or email..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
      </Card>

      <DataTable
        columns={columns}
        data={users.data?.data ?? []}
        loading={users.isLoading}
        getRowId={(u) => u.id}
        emptyMessage={
          search ? 'No users match your search.' : 'No users yet — invite your first staff member.'
        }
      />

      {meta && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{meta.total} record(s)</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span>
              Page {meta.page} of {meta.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <UserDialog open={dialogOpen} onOpenChange={setDialogOpen} user={editing} />

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete user?</DialogTitle>
            <DialogDescription>
              {deleting
                ? `${deleting.firstName} (${deleting.email}) will be deactivated. Their sessions will be revoked.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleteUser.isPending} onClick={confirmDelete}>
              {deleteUser.isPending ? 'Deleting…' : 'Delete user'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              {resetTarget
                ? `Set a new password for ${resetTarget.firstName} (${resetTarget.email}). All active sessions will be revoked.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reset-pw">New password</Label>
            <Input
              id="reset-pw"
              type="password"
              autoComplete="new-password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="At least 10 characters"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={resetPassword.length < 10 || resetUser.isPending}
              onClick={confirmReset}
            >
              {resetUser.isPending ? 'Resetting…' : 'Reset password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
