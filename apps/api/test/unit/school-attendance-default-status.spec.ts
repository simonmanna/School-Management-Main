/** Audit R10 — the register's default status is the configured present one, not the first listed. */
import { pickPresentStatus } from '@erp/shared';

const present = { code: 'present', isPresent: true, isDefault: false, sortOrder: 2 };
const absent = { code: 'absent', isAbsent: true, isDefault: false, sortOrder: 1 };
const late = { code: 'late', isPresent: true, isLate: true, sortOrder: 3 };

describe('pickPresentStatus (R10)', () => {
  it('Absent listed first still defaults to Present', () => {
    expect(pickPresentStatus([absent, present, late])?.code).toBe('present');
  });

  it('a default flag on a non-present status is ignored', () => {
    expect(pickPresentStatus([{ ...absent, isDefault: true }, present])?.code).toBe('present');
  });

  it('prefers the flagged default among present statuses', () => {
    const onSite = { code: 'on_site', isPresent: true, isDefault: true, sortOrder: 9 };
    expect(pickPresentStatus([present, onSite])?.code).toBe('on_site');
  });

  it('never picks a late status as the default', () => {
    expect(pickPresentStatus([late])).toBeNull();
  });

  it('no present status means no default — the teacher marks explicitly', () => {
    expect(pickPresentStatus([absent])).toBeNull();
    expect(pickPresentStatus([])).toBeNull();
    expect(pickPresentStatus(undefined)).toBeNull();
  });

  it('skips inactive statuses', () => {
    expect(pickPresentStatus([{ ...present, active: false }, { code: 'here', isPresent: true }])?.code).toBe('here');
  });
});
