import { ForbiddenException } from '@nestjs/common';
import { UsersService } from '../../src/kernel/auth/staff/users/users.service';

/**
 * F-03 regression — privilege escalation through role ASSIGNMENT.
 *
 * `RolesService` already refused to grant permissions the actor lacks, but
 * `UsersService` connected any role of the organization to any user. The
 * "IT Admin" preset (user admin, no finance or academic authority) could
 * therefore PATCH itself onto Administrator, or reset an administrator's
 * password and sign in as them.
 */

const ADMIN_ROLE = { id: 'role-admin', name: 'Administrator', permissions: ['user:update', 'school:fees:refund:approve', 'role:update'], dataScope: 'school' };
const CLERK_ROLE = { id: 'role-clerk', name: 'Clerk', permissions: ['school:read'], dataScope: 'school' };
const IT_ADMIN = ['user:create', 'user:read', 'user:update', 'user:delete', 'school:read', 'role:read'];

function makeService(actorGrants: string[], targetGrants: string[] = []) {
  const roles = [ADMIN_ROLE, CLERK_ROLE];
  const tx = {
    user: {
      create: jest.fn(async (a: any) => ({ id: 'new-user', ...a.data, roles: [] })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
      findFirst: jest.fn(async () => ({ id: 'target', email: 't@x', firstName: 'T', lastName: null, isActive: true, roles: [] })),
    },
    refreshToken: { updateMany: jest.fn(async () => ({ count: 0 })) },
  };
  const prisma = {
    client: {
      user: {
        findFirst: jest.fn(async (args: any) =>
          args?.where?.email ? null : { id: args?.where?.id ?? 'target', organizationId: 'org', email: 't@x', firstName: 'T', lastName: null, isActive: true, roles: [] },
        ),
      },
      role: {
        findMany: jest.fn(async (args: any) => roles.filter((r) => args.where.id.in.includes(r.id))),
        findFirst: jest.fn(async () => ({ id: 'role-admin' })),
      },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    },
  };
  const tenant = { organizationId: 'org', userId: 'actor', permissions: actorGrants };
  const audit = { recordInTx: jest.fn(async () => undefined), record: jest.fn(async () => undefined) };
  const events = { publish: jest.fn() };
  const password = { hash: jest.fn(async () => 'hash') };
  const resolver = {
    grantedForCaller: jest.fn(async () => actorGrants),
    lookupPermissions: jest.fn(async () => targetGrants),
  };
  const dataScope = { canGrantScope: jest.fn(async () => true) };
  const tokens = { issue: jest.fn(async () => 'secret-invite-token') };
  const notifications = { send: jest.fn(async () => undefined) };
  const service = new UsersService(
    prisma as any,
    tenant as any,
    audit as any,
    events as any,
    password as any,
    resolver as any,
    dataScope as any,
    tokens as any,
    notifications as any,
  );
  return { service, tx, password, prisma, tokens, notifications };
}

describe('UsersService — role assignment cannot escalate privilege', () => {
  it('refuses to create a user with a role carrying permissions the actor lacks', async () => {
    const { service, password } = makeService(IT_ADMIN);
    await expect(
      service.create({ email: 'x@x', password: 'P@ssw0rd!!', firstName: 'X', roleIds: ['role-admin'] } as any),
    ).rejects.toThrow(ForbiddenException);
    expect(password.hash).not.toHaveBeenCalled();
  });

  it('refuses to put the actor onto a stronger role (self-escalation)', async () => {
    const { service, tx } = makeService(IT_ADMIN);
    await expect(service.update('actor', { roleIds: ['role-admin'] } as any)).rejects.toThrow(ForbiddenException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('allows assigning a role whose permissions the actor already holds', async () => {
    const { service } = makeService(IT_ADMIN);
    await expect(
      service.create({ email: 'x@x', password: 'P@ssw0rd!!', firstName: 'X', roleIds: ['role-clerk'] } as any),
    ).resolves.toBeDefined();
  });

  it('refuses to reset the password of a more privileged user (account takeover)', async () => {
    const { service, tx } = makeService(IT_ADMIN, ADMIN_ROLE.permissions);
    await expect(service.resetPassword('target', 'N3wP@ssword!!')).rejects.toThrow(ForbiddenException);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('lets a full administrator assign anything', async () => {
    const { service } = makeService([...IT_ADMIN, ...ADMIN_ROLE.permissions]);
    await expect(
      service.create({ email: 'x@x', password: 'P@ssw0rd!!', firstName: 'X', roleIds: ['role-admin'] } as any),
    ).resolves.toBeDefined();
  });
});

describe('UsersService.invite — replaces the unguarded /organizations/users/invite', () => {
  it('refuses to invite straight into a role the actor could not assign', async () => {
    const { service, tokens } = makeService(IT_ADMIN);
    await expect(
      service.invite({ email: 'new@x.test', firstName: 'N', roleIds: ['role-admin'] }),
    ).rejects.toThrow(ForbiddenException);
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it('never returns the invite token to the inviter, only by email', async () => {
    const { service, notifications } = makeService(IT_ADMIN);
    const out: any = await service.invite({ email: 'New@X.test', firstName: 'N', roleIds: ['role-clerk'] });
    expect(JSON.stringify(out)).not.toContain('secret-invite-token');
    expect(out.passwordHash).toBeUndefined();
    const sent = (notifications.send as jest.Mock).mock.calls[0][0];
    expect(sent.body).toContain('/accept-invite?token=secret-invite-token');
    expect(JSON.stringify(sent.payload)).not.toContain('secret-invite-token');
  });
});

describe('UsersService.update — deactivation', () => {
  it('refuses to deactivate the last administrator', async () => {
    const { service, prisma, tx } = makeService([...IT_ADMIN, ...ADMIN_ROLE.permissions]);
    // No other active admin remains.
    (prisma.client.user.findFirst as jest.Mock).mockImplementation(async (args: any) =>
      args?.where?.id?.not ? null : { id: 'target', organizationId: 'org', email: 't@x', firstName: 'T', lastName: null, isActive: true, roles: [] },
    );
    (prisma.client.role.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.update('target', { isActive: false })).rejects.toThrow(ForbiddenException);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('revokes refresh tokens when a user is deactivated', async () => {
    const { service, tx } = makeService([...IT_ADMIN, ...ADMIN_ROLE.permissions]);
    await service.update('target', { isActive: false });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'target', revokedAt: null } }),
    );
  });
});
