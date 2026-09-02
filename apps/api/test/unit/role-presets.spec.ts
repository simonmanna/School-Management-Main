/**
 * Unit — the school role presets and the separations they encode.
 *
 * `SCHOOL_ROLE_PRESETS` in `@erp/shared` documents a set of segregation-of-duty
 * invariants and says they are "enforced by role-presets.spec.ts". That spec did
 * not exist, so the invariants were a comment: nothing stopped a grant being
 * added to the Bursar that let them approve their own waiver, and nothing
 * noticed when Phase 5 shipped `school:exams:operate` without adding it to the
 * Exams Officer — which meant a freshly provisioned school's exam office could
 * not open the console that runs a sitting.
 *
 * This is that spec. It asserts two different things:
 *
 *  1. **Separations.** Who may not hold what, and why. These are the rules a
 *     school's auditor would ask about: whoever enters a mark does not approve
 *     it, whoever collects money does not approve relief from it, and whoever
 *     administers the system holds no academic or financial authority.
 *
 *  2. **Coverage.** That each preset can actually do the job its description
 *     claims — because a role missing one grant is discovered by a member of
 *     staff at the worst moment, not by a reviewer reading a list.
 *
 * Phase 6 role-privacy exit gate. The runtime half (does the holder own this
 * row?) is `school-teacher-ownership.spec.ts`; what each route demands is
 * `route-permission-coverage.spec.ts`.
 */
import { ALL_PERMISSIONS, PORTAL_ROLE_PRESETS, SCHOOL_ROLE_PRESETS } from '@erp/shared';

type Preset = { name: string; description: string; permissions: readonly string[]; dataScope?: string };

const ALL_PRESETS = [...SCHOOL_ROLE_PRESETS, ...PORTAL_ROLE_PRESETS] as readonly Preset[];
const byName = (name: string): Preset => {
  const found = ALL_PRESETS.find((p) => p.name === name);
  if (!found) throw new Error(`No role preset named '${name}'`);
  return found;
};
const holds = (name: string, permission: string): boolean => byName(name).permissions.includes(permission);

/** Grants that change a mark or a published result. */
const MARK_AND_RESULT_WRITES = [
  'school:grades:write', 'school:grades:own', 'school:grades:approve',
  'school:marks:moderate', 'school:results:compute', 'school:results:approve',
  'school:results:publish', 'school:results:amend',
];

/** Grants that move money or bill for it. */
const FEE_GRANTS = [
  'school:fees:write', 'school:fees:collect', 'school:fees:refund', 'school:fees:reconcile',
  'school:fees:waiver:approve', 'school:fees:credit:approve', 'school:fees:refund:approve',
];

describe('school role presets', () => {
  const catalogue = new Set<string>(ALL_PERMISSIONS as readonly string[]);

  describe('catalogue integrity', () => {
    it('every grant in every preset is a real permission', () => {
      const unknown: string[] = [];
      for (const preset of ALL_PRESETS) {
        for (const grant of preset.permissions) if (!catalogue.has(grant)) unknown.push(`${preset.name}: ${grant}`);
      }
      expect(unknown).toEqual([]);
    });

    it('no preset lists the same grant twice', () => {
      for (const preset of ALL_PRESETS) {
        expect(new Set(preset.permissions).size).toBe(preset.permissions.length);
      }
    });

    it('preset names are unique', () => {
      const names = ALL_PRESETS.map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe('separation of duty', () => {
    it('the Bursar collects but never approves its own relief', () => {
      expect(holds('Bursar', 'school:fees:collect')).toBe(true);
      for (const grant of ['school:fees:waiver:approve', 'school:fees:credit:approve', 'school:fees:refund:approve', 'school:fees:writeoff']) {
        expect(holds('Bursar', grant)).toBe(false);
      }
    });

    it('the Head Teacher approves relief but never collects it', () => {
      expect(holds('Head Teacher', 'school:fees:waiver:approve')).toBe(true);
      expect(holds('Head Teacher', 'school:fees:collect')).toBe(false);
      expect(holds('Head Teacher', 'school:fees:write')).toBe(false);
    });

    it('the Class Teacher enters marks and approves none of them', () => {
      expect(holds('Class Teacher', 'school:grades:own')).toBe(true);
      expect(holds('Class Teacher', 'school:grades:approve')).toBe(false);
      expect(holds('Class Teacher', 'school:results:approve')).toBe(false);
      expect(holds('Class Teacher', 'school:results:publish')).toBe(false);
    });

    it('a teacher never holds the org-wide marking or register grant', () => {
      for (const role of ['Class Teacher', 'Subject Teacher', 'Teacher']) {
        expect(holds(role, 'school:grades:write')).toBe(false);
        expect(holds(role, 'school:attendance:write')).toBe(false);
      }
    });

    it('the Exams Officer holds no fee authority', () => {
      for (const grant of FEE_GRANTS) expect(holds('Exams Officer', grant)).toBe(false);
    });

    /**
     * The Exams Officer enters marks (`school:grades:write`), so giving them
     * result approval would let one person originate a mark and sign off the
     * result it feeds. Approval sits with the Head Teacher and Deputy Head.
     */
    it('the Exams Officer cannot approve the results it computes', () => {
      expect(holds('Exams Officer', 'school:grades:write')).toBe(true);
      expect(holds('Exams Officer', 'school:results:compute')).toBe(true);
      expect(holds('Exams Officer', 'school:results:approve')).toBe(false);
      expect(holds('Exams Officer', 'school:grades:approve')).toBe(false);
    });

    it('someone other than the Exams Officer can approve, or nothing publishes', () => {
      const approvers = SCHOOL_ROLE_PRESETS.filter((p) => p.permissions.includes('school:results:approve')).map((p) => p.name);
      expect(approvers.length).toBeGreaterThan(0);
      expect(approvers).not.toContain('Exams Officer');
    });

    it('the Registrar moves learners and touches no mark or fee', () => {
      expect(holds('Registrar', 'school:enrollment:write')).toBe(true);
      for (const grant of [...MARK_AND_RESULT_WRITES, ...FEE_GRANTS]) {
        expect(holds('Registrar', grant)).toBe(false);
      }
    });

    it('the IT Admin holds no school finance or academic authority', () => {
      for (const grant of [...MARK_AND_RESULT_WRITES, ...FEE_GRANTS]) {
        expect(holds('IT Admin', grant)).toBe(false);
      }
      expect(holds('IT Admin', 'role:update')).toBe(true);
    });

    it('the Exams Officer allocates scripts and does not mark them', () => {
      expect(holds('Exams Officer', 'school:exams:allocate')).toBe(true);
      expect(holds('Exams Officer', 'school:exams:mark')).toBe(false);
    });

    it('promotion is decided by leadership, not by the office that computes results', () => {
      expect(holds('Head Teacher', 'school:promotion:decide')).toBe(true);
      expect(holds('Exams Officer', 'school:promotion:decide')).toBe(false);
      expect(holds('Registrar', 'school:promotion:decide')).toBe(false);
    });
  });

  describe('coverage — each preset can do its job', () => {
    it('the Exams Officer can run a Phase 5 examination end to end', () => {
      for (const grant of ['school:exams:write', 'school:exams:operate', 'school:exams:custody', 'school:exams:allocate', 'school:exams:consideration']) {
        expect(holds('Exams Officer', grant)).toBe(true);
      }
    });

    it('the Exams Officer can file a Phase 6 national submission', () => {
      for (const grant of ['school:statutory:read', 'school:statutory:write', 'school:statutory:export', 'school:candidates:write']) {
        expect(holds('Exams Officer', grant)).toBe(true);
      }
    });

    it('the Head Teacher can publish a report card and sign off a return', () => {
      for (const grant of ['school:reports:documents:publish', 'school:statutory:read', 'school:statutory:export']) {
        expect(holds('Head Teacher', grant)).toBe(true);
      }
    });

    it('the Head Teacher can apply the promotion they decided', () => {
      expect(holds('Head Teacher', 'school:promotion:apply')).toBe(true);
    });

    it('every staff preset can read the school it works in', () => {
      const exempt = new Set(['IT Admin', 'HR Officer']);
      for (const preset of SCHOOL_ROLE_PRESETS) {
        if (exempt.has(preset.name)) continue;
        expect(preset.permissions).toContain('school:read');
      }
    });
  });

  describe('portal presets', () => {
    it('never grant school:read, which ~300 school routes are gated on alone', () => {
      for (const preset of PORTAL_ROLE_PRESETS) {
        if (preset.name === 'Teacher') continue; // documented widening; staff, not family
        expect(preset.permissions).not.toContain('school:read');
      }
    });

    it('always grant portal:self, or the app cannot resolve who it is talking to', () => {
      for (const preset of PORTAL_ROLE_PRESETS) {
        expect(preset.permissions).toContain('school:portal:self');
      }
    });

    it('grant a family no mark or result authority of any kind', () => {
      for (const name of ['Student', 'Parent']) {
        for (const grant of MARK_AND_RESULT_WRITES) expect(holds(name, grant)).toBe(false);
      }
    });

    it('grant a family no statutory or candidate-registry access', () => {
      for (const name of ['Student', 'Parent']) {
        for (const grant of ['school:statutory:read', 'school:statutory:export', 'school:candidates:write']) {
          expect(holds(name, grant)).toBe(false);
        }
      }
    });

    it('let a learner submit their own work and grade nobody else’s', () => {
      expect(holds('Student', 'school:assignments:submit')).toBe(true);
      expect(holds('Student', 'school:assignments:grade')).toBe(false);
    });

    it('scope the Subject Teacher preset to their own rows', () => {
      expect(byName('Subject Teacher').dataScope).toBe('own');
      expect(byName('Class Teacher').dataScope).toBe('class');
    });
  });
});
