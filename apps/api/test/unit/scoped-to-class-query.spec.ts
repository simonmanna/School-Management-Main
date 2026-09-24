import { ForbiddenException } from '@nestjs/common';
import { ScopedToClassGuard } from '../../src/kernel/auth/guards/scoped-to-class.guard';

/**
 * R1 (Wave 5): teacher reads name the class in the QUERY string
 * (GET /attendance/register?classId=…). The guard only looked at params and
 * body, so a query-string read was refused outright — or, where the decorator
 * was left off for that reason, not scoped at all.
 */
describe('ScopedToClassGuard reads ?classId=', () => {
  const make = (allowed: string[]) => {
    const reflector = { get: () => 'classId' } as any;
    const dataScope = {
      assertMayTouchClass: jest.fn(async (id: string) => {
        if (!allowed.includes(id)) throw new ForbiddenException('You may only act on classes you teach');
      }),
    } as any;
    return new ScopedToClassGuard(reflector, dataScope);
  };
  const ctx = (req: any) => ({ getHandler: () => null, switchToHttp: () => ({ getRequest: () => req }) }) as any;

  it('admits a teacher reading their own class', async () => {
    await expect(make(['c1']).canActivate(ctx({ params: {}, query: { classId: 'c1' }, body: {} }))).resolves.toBe(true);
  });

  it("refuses another teacher's class named in the query", async () => {
    await expect(make(['c1']).canActivate(ctx({ params: {}, query: { classId: 'c2' }, body: {} }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
