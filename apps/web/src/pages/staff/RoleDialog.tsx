import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePermissionCatalog, useCreateRole, useUpdateRole } from '@/features/staff/api';
import type { Role } from '@/features/staff/types';

const schema = z.object({
  name: z.string().min(2, 'At least 2 characters').max(64),
  description: z.string().max(250).optional(),
  permissions: z.array(z.string()).min(1, 'Pick at least one permission'),
});
type FormValues = z.infer<typeof schema>;

interface RoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the dialog edits this role; otherwise it creates one. */
  role?: Role | null;
}

export function RoleDialog({ open, onOpenChange, role }: RoleDialogProps) {
  const isEdit = !!role;
  const isSystem = role?.isSystem ?? false;

  const catalog = usePermissionCatalog();
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '', permissions: [] },
  });

  // Reset whenever the dialog opens / role changes.
  useEffect(() => {
    if (!open) return;
    form.reset({
      name: role?.name ?? '',
      description: role?.description ?? '',
      permissions: role?.permissions ?? [],
    });
  }, [open, role, form]);

  const selected = form.watch('permissions');

  const grouped = catalog.data?.groups ?? [];

  const selectedCount = selected.length;
  const totalCount = useMemo(
    () => grouped.reduce((sum, g) => sum + g.permissions.length, 0),
    [grouped],
  );

  const togglePerm = (key: string, on: boolean) => {
    const current = form.getValues('permissions') ?? [];
    if (on) {
      form.setValue('permissions', [...new Set([...current, key])], { shouldValidate: true });
    } else {
      form.setValue(
        'permissions',
        current.filter((k) => k !== key),
        { shouldValidate: true },
      );
    }
  };

  const toggleGroup = (groupPerms: { key: string }[], on: boolean) => {
    const current = form.getValues('permissions') ?? [];
    if (on) {
      form.setValue(
        'permissions',
        [...new Set([...current, ...groupPerms.map((p) => p.key)])],
        { shouldValidate: true },
      );
    } else {
      const remove = new Set(groupPerms.map((p) => p.key));
      form.setValue(
        'permissions',
        current.filter((k) => !remove.has(k)),
        { shouldValidate: true },
      );
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (isEdit && role) {
        await updateRole.mutateAsync({
          id: role.id,
          input: {
            name: values.name,
            description: values.description,
            permissions: values.permissions,
          },
        });
      } else {
        await createRole.mutateAsync({
          name: values.name,
          description: values.description,
          permissions: values.permissions,
        });
      }
      onOpenChange(false);
    } catch {
      /* error toast is handled in the mutation hook */
    }
  });

  const isPending = createRole.isPending || updateRole.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isSystem ? (
              <ShieldAlert className="h-5 w-5 text-amber-500" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-primary" />
            )}
            {isEdit ? 'Edit Role' : 'New Role'}
          </DialogTitle>
          <DialogDescription>
            {isSystem
              ? 'This is a seeded system role. You can rename it, change its description, and modify its permissions here.'
              : 'Define a role by naming it and selecting the permissions it grants.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <fieldset className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" placeholder="Cashier" {...form.register('name')} />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input id="description" placeholder="Front-of-house staff" {...form.register('description')} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Permissions</Label>
                <span className="text-xs text-muted-foreground">
                  {selectedCount} of {totalCount} selected
                </span>
              </div>
              <div className="h-[320px] overflow-y-auto rounded-md border bg-muted/30 p-3">
                {catalog.isLoading && <p className="text-sm text-muted-foreground">Loading catalog…</p>}
                <div className="space-y-3">
                  {grouped.map((group) => {
                    const groupSelected = group.permissions.filter((p) => selected.includes(p.key)).length;
                    const allOn = groupSelected === group.permissions.length;
                    const someOn = groupSelected > 0 && !allOn;
                    return (
                      <div key={group.resource} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.permissions, !allOn)}
                            className="flex items-center gap-2 text-left"
                          >
                            <span
                              className={`flex h-4 w-4 items-center justify-center rounded border ${
                                allOn
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : someOn
                                    ? 'border-primary bg-primary/40 text-primary-foreground'
                                    : 'border-input bg-background'
                              }`}
                            >
                              {allOn && '✓'}
                              {someOn && '–'}
                            </span>
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {group.resource}
                            </span>
                          </button>
                          <Badge variant="outline" className="text-[10px]">
                            {groupSelected}/{group.permissions.length}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 pl-6">
                          {group.permissions.map((p) => {
                            const on = selected.includes(p.key);
                            return (
                              <label key={p.key} className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-input"
                                  checked={on}
                                  onChange={(e) => togglePerm(p.key, e.target.checked)}
                                />
                                <span className="flex-1">{p.action}</span>
                                <span className="font-mono text-[10px] text-muted-foreground">{p.key}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {form.formState.errors.permissions && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.permissions.message as string}
                </p>
              )}
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create role'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
