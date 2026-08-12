import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { useRoles, useCreateUser, useUpdateUser } from '@/features/staff/api';
import type { UserSummary } from '@/features/staff/types';

const createSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(10, 'At least 10 characters'),
  firstName: z.string().min(1, 'Required').max(64),
  lastName: z.string().max(64).optional(),
  isActive: z.boolean(),
  roleIds: z.array(z.string()),
});
const updateSchema = z.object({
  email: z.string().email('Invalid email'),
  firstName: z.string().min(1, 'Required').max(64),
  lastName: z.string().max(64).optional(),
  isActive: z.boolean(),
  roleIds: z.array(z.string()),
});
type CreateValues = z.infer<typeof createSchema>;
type UpdateValues = z.infer<typeof updateSchema>;

interface UserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: UserSummary | null;
}

export function UserDialog({ open, onOpenChange, user }: UserDialogProps) {
  const isEdit = !!user;
  const roles = useRoles();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();

  // Use the create schema for new users, the update schema for editing.
  // We track which schema is in use to type the form correctly.
  const [schema, setSchema] = useState<'create' | 'update'>('create');
  useEffect(() => {
    setSchema(isEdit ? 'update' : 'create');
  }, [isEdit, open]);

  const form = useForm<CreateValues | UpdateValues>({
    resolver: zodResolver(isEdit ? updateSchema : createSchema) as any,
    defaultValues: defaultValuesFor(isEdit, user),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(defaultValuesFor(isEdit, user));
  }, [open, isEdit, user, form]);

  const selectedRoleIds = form.watch('roleIds') ?? [];

  const toggleRole = (id: string, on: boolean) => {
    const current = form.getValues('roleIds') ?? [];
    if (on) {
      form.setValue('roleIds', [...new Set([...current, id])]);
    } else {
      form.setValue('roleIds', current.filter((r) => r !== id));
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (isEdit && user) {
        const { email, firstName, lastName, isActive, roleIds } = values as UpdateValues;
        await updateUser.mutateAsync({
          id: user.id,
          input: { email, firstName, lastName, isActive, roleIds },
        });
      } else {
        const { email, password, firstName, lastName, isActive, roleIds } = values as CreateValues;
        await createUser.mutateAsync({
          email,
          password,
          firstName,
          lastName,
          isActive,
          roleIds,
        });
      }
      onOpenChange(false);
    } catch {
      /* toast handled in mutation */
    }
  });

  const isPending = createUser.isPending || updateUser.isPending;
  const allRoles = roles.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit User' : 'New User'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update name, email, status, or role assignments. Use "Reset password" from the list to issue a new password.'
              : 'Create a staff account. The user will log in with the email and the initial password.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" placeholder="Jane" {...form.register('firstName')} />
              {form.formState.errors.firstName && (
                <p className="text-sm text-destructive">{form.formState.errors.firstName.message as string}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" placeholder="Doe" {...form.register('lastName')} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="jane@cafe.test"
              {...form.register('email')}
            />
            {form.formState.errors.email && (
              <p className="text-sm text-destructive">{form.formState.errors.email.message as string}</p>
            )}
          </div>

          {!isEdit && schema === 'create' && (
            <div className="space-y-2">
              <Label htmlFor="password">Initial password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 10 characters"
                {...form.register('password' as any)}
              />
              {(form.formState.errors as any).password && !isEdit && (
                <p className="text-sm text-destructive">
                  {(form.formState.errors as any).password?.message as string}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                The user can change it after first login. Use "Reset password" later if they forget it.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Roles</Label>
            <div className="rounded-md border bg-muted/30 p-3 max-h-44 overflow-y-auto space-y-1">
              {roles.isLoading && <p className="text-sm text-muted-foreground">Loading roles…</p>}
              {allRoles.length === 0 && !roles.isLoading && (
                <p className="text-sm text-muted-foreground">
                  No roles available. Create a role first.
                </p>
              )}
              {allRoles.map((r) => {
                const on = selectedRoleIds.includes(r.id);
                return (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={on}
                      onChange={(e) => toggleRole(r.id, e.target.checked)}
                    />
                    <span className="flex-1">{r.name}</span>
                    {r.isSystem && (
                      <Badge variant="secondary" className="text-[10px]">
                        System
                      </Badge>
                    )}
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {r.permissions.length} perms
                    </span>
                  </label>
                );
              })}
            </div>
            {selectedRoleIds.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedRoleIds.length} role(s) selected
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              {...form.register('isActive')}
            />
            <span>Active (uncheck to disable login without deleting)</span>
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function defaultValuesFor(isEdit: boolean, user?: UserSummary | null) {
  if (isEdit && user) {
    return {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName ?? '',
      isActive: user.isActive,
      roleIds: user.roles.map((r) => r.id),
    } as UpdateValues;
  }
  return {
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    isActive: true,
    roleIds: [],
  } as CreateValues;
}
