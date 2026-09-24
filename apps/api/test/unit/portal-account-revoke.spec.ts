import { PortalAccountService } from '../../src/modules/school/portals/portal-account.service';

/**
 * Revoking a portal identity must leave no family authority behind. The role
 * used to survive revocation, so the next sign-in had the Parent grant and no
 * claim — which PortalIdentityService then read as "staff".
 */
function makeService(remainingIdentities: number) {
  const prisma = {
    client: {
      portalIdentity: {
        findFirst: jest.fn(async () => ({ id: 'pi_1', userId: 'u_parent', organizationId: 'org_1' })),
        update: jest.fn(async () => ({})),
        count: jest.fn(async () => remainingIdentities),
      },
      refreshToken: { updateMany: jest.fn(async () => ({ count: 1 })) },
      role: { findMany: jest.fn(async () => [{ id: 'role_parent' }, { id: 'role_student' }]) },
      user: { update: jest.fn(async () => ({})) },
    },
  };
  const tenant = { organizationId: 'org_1' };
  const audit = { record: jest.fn(async () => undefined) };
  const svc = new PortalAccountService(prisma as any, tenant as any, {} as any, {} as any, {} as any, audit as any);
  return { svc, prisma };
}

describe('PortalAccountService.revoke', () => {
  it('removes the family portal roles when the last identity is revoked', async () => {
    const { svc, prisma } = makeService(0);
    await svc.revoke('pi_1');
    expect(prisma.client.user.update).toHaveBeenCalledWith({
      where: { id: 'u_parent' },
      data: { roles: { disconnect: [{ id: 'role_parent' }, { id: 'role_student' }] } },
    });
    expect(prisma.client.refreshToken.updateMany).toHaveBeenCalled();
  });

  it('keeps the role while another live identity remains (a parent of two families)', async () => {
    const { svc, prisma } = makeService(1);
    await svc.revoke('pi_1');
    expect(prisma.client.user.update).not.toHaveBeenCalled();
  });
});
