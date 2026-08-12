/**
 * Unit tests for ReportCardTemplateService.isSubsidiarySubject (P0-3, C3).
 *
 * Bug: the helper always returned `false`, regardless of subject code.
 * Result: every UACE subject (including General Paper and Sub-ICT) was
 * treated as a principal, the "best 3 principals" aggregate counted
 * them, and the layout's Principal/Subsidiary sectioning was meaningless.
 *
 * Fix: subsidiary codes start with "SUB-" (case-insensitive). Anything
 * else is a principal. Other grading systems (UCE, CBC, generic) have
 * no concept of subsidiary subjects and always return false.
 */
import { isSubsidiarySubject } from '../../src/modules/school/examinations/report-card-template.service';

describe('isSubsidiarySubject (P0-3, C3 — UACE subsidiary detection)', () => {
  describe('UACE', () => {
    it('flags subjects whose code starts with "SUB-"', () => {
      expect(isSubsidiarySubject('General Paper', 'SUB-GP', 'UACE')).toBe(true);
      expect(isSubsidiarySubject('Subsidiary ICT', 'SUB-ICT', 'UACE')).toBe(true);
    });

    it('is case-insensitive for the SUB- prefix', () => {
      expect(isSubsidiarySubject('General Paper', 'sub-gp', 'UACE')).toBe(true);
      expect(isSubsidiarySubject('General Paper', 'Sub-Gp', 'UACE')).toBe(true);
    });

    it('flags anything starting with "SUB-" (regardless of name)', () => {
      // Even if the name looks principal, the code wins — schools tag via code.
      expect(isSubsidiarySubject('Mathematics', 'SUB-MATH', 'UACE')).toBe(true);
    });

    it('does not flag subjects with a non-SUB code (principals)', () => {
      expect(isSubsidiarySubject('Mathematics', 'MATH', 'UACE')).toBe(false);
      expect(isSubsidiarySubject('Physics', 'PHY', 'UACE')).toBe(false);
      expect(isSubsidiarySubject('Economics', 'ECON', 'UACE')).toBe(false);
    });

    it('does not flag a code that starts with SUB but has no dash', () => {
      // SUBGP without dash is not a valid subsidiary code.
      expect(isSubsidiarySubject('General Paper', 'SUBGP', 'UACE')).toBe(false);
    });

    it('defaults to principal when the subject has no code', () => {
      // Schools that haven't tagged their curriculum default to principal.
      expect(isSubsidiarySubject('General Paper', undefined, 'UACE')).toBe(false);
      expect(isSubsidiarySubject('General Paper', '', 'UACE')).toBe(false);
    });
  });

  describe('other grading systems', () => {
    it('never treats subjects as subsidiary under UCE', () => {
      expect(isSubsidiarySubject('General Paper', 'SUB-GP', 'UCE')).toBe(false);
    });

    it('never treats subjects as subsidiary under CBC', () => {
      expect(isSubsidiarySubject('General Paper', 'SUB-GP', 'CBC')).toBe(false);
    });

    it('never treats subjects as subsidiary under generic', () => {
      expect(isSubsidiarySubject('General Paper', 'SUB-GP', 'generic')).toBe(false);
    });
  });
});
