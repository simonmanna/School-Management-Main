import { ConversationAccessService } from './conversation-access.service';

const READ = 'communication:conversation:read';
const READ_ALL = 'communication:conversation:read_all';

/** Pure access-rule tests — no DB, no DI. */
describe('ConversationAccessService.canAccess', () => {
  const subject = (permissions: string[] = []) => ({ userId: 'u1', permissions });

  it('allows an active participant, even on a private conversation', () => {
    const conv = { visibility: 'private', visibleToPermissions: [] };
    expect(ConversationAccessService.canAccess(conv, true, subject())).toBe(true);
  });

  it('denies a non-participant on a private conversation — even with read_all', () => {
    const conv = { visibility: 'private', visibleToPermissions: [] };
    expect(ConversationAccessService.canAccess(conv, false, subject([READ_ALL]))).toBe(false);
  });

  it('allows org-visible when the user holds conversation:read', () => {
    const conv = { visibility: 'org', visibleToPermissions: [] };
    expect(ConversationAccessService.canAccess(conv, false, subject([READ]))).toBe(true);
  });

  it('denies org-visible without conversation:read', () => {
    const conv = { visibility: 'org', visibleToPermissions: [] };
    expect(ConversationAccessService.canAccess(conv, false, subject([]))).toBe(false);
  });

  it('allows role-visible when permissions intersect visibleToPermissions', () => {
    const conv = { visibility: 'role', visibleToPermissions: ['pos:kds'] };
    expect(ConversationAccessService.canAccess(conv, false, subject(['pos:kds']))).toBe(true);
  });

  it('denies role-visible when permissions do not intersect', () => {
    const conv = { visibility: 'role', visibleToPermissions: ['pos:kds'] };
    expect(ConversationAccessService.canAccess(conv, false, subject(['pos:checkout']))).toBe(false);
  });

  it('allows read_all to bypass org/role visibility (but not private)', () => {
    expect(
      ConversationAccessService.canAccess({ visibility: 'org', visibleToPermissions: [] }, false, subject([READ_ALL])),
    ).toBe(true);
    expect(
      ConversationAccessService.canAccess({ visibility: 'role', visibleToPermissions: ['x'] }, false, subject([READ_ALL])),
    ).toBe(true);
  });
});
