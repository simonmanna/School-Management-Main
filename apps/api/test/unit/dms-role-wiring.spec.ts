/**
 * Wave 17 security: DMS permission keys go to Administrator only, never to the
 * family portal roles, and a portal role already polluted by the old boot
 * wiring is repaired.
 */
import { wireDmsRoleKeys } from '../../src/modules/documents/dms.seed-registry';
import { buildPermissionRows } from '../../src/modules/documents/dms.seed-data';
import { PORTAL_ROLE_PRESETS } from '@erp/shared';

function fakeClient(roles: Array<{ id: string; name: string; isSystem: boolean; permissions: string[] }>) {
  return {
    roles,
    role: {
      findMany: jest.fn(async ({ where }: any) =>
        roles.filter(
          (r) =>
            (where.name === undefined ||
              (typeof where.name === 'string' ? r.name === where.name : where.name.in.includes(r.name))) &&
            (where.isSystem === undefined || r.isSystem === where.isSystem),
        ),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const r = roles.find((x) => x.id === where.id)!;
        r.permissions = data.permissions;
        return r;
      }),
    },
  };
}

describe('wireDmsRoleKeys (Wave 17)', () => {
  const dms = buildPermissionRows().map((r) => r.key);
  const parentPreset = PORTAL_ROLE_PRESETS.find((p) => p.name === 'Parent')!.permissions as readonly string[];

  it('gives Administrator every DMS key and leaves other staff roles alone', async () => {
    const c = fakeClient([
      { id: 'a', name: 'Administrator', isSystem: true, permissions: ['school:read'] },
      { id: 'b', name: 'Bursar', isSystem: false, permissions: ['school:fees:read'] },
    ]);
    await wireDmsRoleKeys(c);
    expect(c.roles[0].permissions).toEqual(expect.arrayContaining(dms));
    expect(c.roles[1].permissions).toEqual(['school:fees:read']);
  });

  it('never grants DMS keys to the Parent or Student portal roles', async () => {
    const c = fakeClient([
      { id: 'p', name: 'Parent', isSystem: true, permissions: [...parentPreset] },
      { id: 's', name: 'Student', isSystem: true, permissions: ['school:portal:student'] },
    ]);
    await wireDmsRoleKeys(c);
    expect(c.roles[0].permissions.some((k) => k.startsWith('document:'))).toBe(false);
    expect(c.roles[1].permissions.some((k) => k.startsWith('document:'))).toBe(false);
  });

  it('strips DMS keys the old boot wiring added to a portal role, keeping its real grants', async () => {
    const c = fakeClient([{ id: 'p', name: 'Parent', isSystem: true, permissions: [...parentPreset, ...dms] }]);
    const updated = await wireDmsRoleKeys(c);
    expect(updated).toBe(1);
    expect(new Set(c.roles[0].permissions)).toEqual(new Set(parentPreset));
    // Idempotent.
    expect(await wireDmsRoleKeys(c)).toBe(0);
  });
});
