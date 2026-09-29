/**
 * Wave 16 — attendance guardian alerts (audit P1-4).
 *
 *  - an early departure alerts as "left early"; an absence never does
 *  - the Nth absent school day in a row alerts once, and only once
 *  - the below-threshold sweep judges each pupil by their class's threshold
 *    and honours notifyBelowThreshold
 */
import { AttendanceNotificationsSubscriber } from '../../src/modules/school/attendance/attendance-notifications.subscriber';

const ORG = 'org_att';
const CATALOG = [
  { code: 'present', isPresent: true, isLate: false, isAbsent: false },
  { code: 'late', isPresent: false, isLate: true, isAbsent: false },
  { code: 'absent', isPresent: false, isLate: false, isAbsent: true },
];

function make(opts: { thresholds: any[]; attendance?: any[] }) {
  const notifyContact = jest.fn().mockResolvedValue(undefined);
  const findAttendance = jest.fn().mockImplementation(async (args: any) => {
    const rows = opts.attendance ?? [];
    if (args.take) return rows.slice(0, args.take);
    return rows;
  });
  const prisma: any = {
    client: {
      attendanceThreshold: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
          opts.thresholds.find((t) => t.classId === (where.classId ?? null)) ?? null,
        ),
        findMany: jest.fn().mockResolvedValue(opts.thresholds),
      },
      attendanceStatusConfig: { findMany: jest.fn().mockResolvedValue(CATALOG) },
      studentAttendance: { findMany: findAttendance },
      studentGuardian: {
        findMany: jest.fn().mockResolvedValue([{ guardianContact: { id: 'c1', email: 'g@x', phone: '256700000000' } }]),
      },
      studentProfile: { findFirst: jest.fn().mockResolvedValue({ partner: { name: 'Amina N' } }) },
    },
  };
  const events = { subscribe: jest.fn() };
  const sub = new AttendanceNotificationsSubscriber(events as any, prisma, { notifyContact } as any, {} as any);
  return { sub, notifyContact, findAttendance };
}

const base = { organizationId: ORG, classId: 'cls1', notifyAbsent: true, notifyLate: true, notifyEarly: true, notifyBelowThreshold: true, minAttendancePct: 75 };
const onMarked = (sub: any, entries: any[], extra: any = {}) =>
  sub.onMarked({ organizationId: ORG, date: '2026-03-04', classId: 'cls1', entries, ...extra });

describe('attendance alerts — marking', () => {
  it('an early departure alerts as "left early"', async () => {
    const { sub, notifyContact } = make({ thresholds: [base] });
    await onMarked(sub, [{ studentProfileId: 's1', status: 'present', isPresent: true, earlyDepartureMinutes: 45 }]);
    expect(notifyContact).toHaveBeenCalledTimes(1);
    expect(notifyContact.mock.calls[0][0].title).toBe('Left early');
  });

  it('an absence with notifyAbsent off is not mislabelled as "left early"', async () => {
    const { sub, notifyContact } = make({ thresholds: [{ ...base, notifyAbsent: false }] });
    await onMarked(sub, [{ studentProfileId: 's1', status: 'absent', isAbsent: true }]);
    expect(notifyContact).not.toHaveBeenCalled();
  });

  it('the Nth absent day in a row sends one "Repeated absence" alert', async () => {
    const { sub, notifyContact } = make({
      thresholds: [{ ...base, notifyAbsent: false, consecutiveAbsenceAlert: 3 }],
      attendance: [{ status: 'absent' }, { status: 'absent' }, { status: 'absent' }, { status: 'present' }],
    });
    await onMarked(sub, [{ studentProfileId: 's1', status: 'absent', isAbsent: true }]);
    expect(notifyContact).toHaveBeenCalledTimes(1);
    expect(notifyContact.mock.calls[0][0].title).toBe('Repeated absence');
    expect(notifyContact.mock.calls[0][0].body).toContain('3 school days in a row');
  });

  it('the (N+1)th absent day is silent', async () => {
    const { sub, notifyContact } = make({
      thresholds: [{ ...base, notifyAbsent: false, consecutiveAbsenceAlert: 3 }],
      attendance: [{ status: 'absent' }, { status: 'absent' }, { status: 'absent' }, { status: 'absent' }],
    });
    await onMarked(sub, [{ studentProfileId: 's1', status: 'absent', isAbsent: true }]);
    expect(notifyContact).not.toHaveBeenCalled();
  });

  it('a broken streak does not alert', async () => {
    const { sub, notifyContact } = make({
      thresholds: [{ ...base, notifyAbsent: false, consecutiveAbsenceAlert: 3 }],
      attendance: [{ status: 'absent' }, { status: 'late' }, { status: 'absent' }],
    });
    await onMarked(sub, [{ studentProfileId: 's1', status: 'absent', isAbsent: true }]);
    expect(notifyContact).not.toHaveBeenCalled();
  });

  it('period registers never count toward a daily streak', async () => {
    const { sub, findAttendance } = make({ thresholds: [{ ...base, consecutiveAbsenceAlert: 2 }] });
    await onMarked(sub, [{ studentProfileId: 's1', status: 'absent', isAbsent: true }], { periodId: 'p1' });
    expect(findAttendance).not.toHaveBeenCalled();
  });
});

describe('attendance alerts — below-threshold sweep', () => {
  const rows = [
    // s1 in cls1: 2/4 = 50%
    ...['present', 'absent', 'absent', 'present'].map((status) => ({ studentProfileId: 's1', classId: 'cls1', status })),
    // s2 in cls2: 3/4 = 75%
    ...['present', 'late', 'present', 'absent'].map((status) => ({ studentProfileId: 's2', classId: 'cls2', status })),
  ];

  it('judges each pupil by their own class threshold', async () => {
    const { sub, notifyContact } = make({
      thresholds: [
        { ...base, classId: null, minAttendancePct: 40 },
        { ...base, classId: 'cls2', minAttendancePct: 80 },
      ],
      attendance: rows,
    });
    const res = await sub.belowThresholdSweep(ORG);
    expect(res.flagged).toEqual([{ studentProfileId: 's2', pct: 75, floor: 80 }]);
    expect(notifyContact).toHaveBeenCalledTimes(1);
  });

  it('skips pupils whose threshold has notifyBelowThreshold off', async () => {
    const { sub, notifyContact } = make({
      thresholds: [{ ...base, classId: null, minAttendancePct: 90, notifyBelowThreshold: false }],
      attendance: rows,
    });
    const res = await sub.belowThresholdSweep(ORG);
    expect(res.flagged).toEqual([]);
    expect(notifyContact).not.toHaveBeenCalled();
  });
});
