/**
 * `bridgedComponentId` — which weighting component an exam paper counts toward.
 *
 * A policy with "Mid-term exam 30%" and "End of term exam 70%" has two
 * components of kind `exam`. The kernel only guesses by kind when exactly one
 * such component exists, so an exam paper whose minted column carried no (or a
 * stale) componentId counted nowhere. Components now name their exam type and
 * the paper is bound to the governing policy's component at compute time.
 */
import { bridgedComponentId } from '../../src/modules/school/assessment/result-run.service';

const components = [
  { id: 'cmp_ca', examTypeId: null },
  { id: 'cmp_mid', examTypeId: 'et_mid' },
  { id: 'cmp_eot', examTypeId: 'et_eot' },
];
const examTypeOf = new Map([['sched_mid', 'et_mid'], ['sched_eot', 'et_eot'], ['sched_other', 'et_mock']]);

describe('bridgedComponentId', () => {
  it('binds an exam paper to the component naming its exam type', () => {
    expect(bridgedComponentId({ componentId: null, sourceType: 'exam_session', sourceRef: 'sched_eot' }, components, examTypeOf)).toBe('cmp_eot');
    expect(bridgedComponentId({ componentId: null, sourceType: 'exam_session', sourceRef: 'sched_mid' }, components, examTypeOf)).toBe('cmp_mid');
  });

  it('overrides a stale component stamped from an older policy revision', () => {
    expect(bridgedComponentId({ componentId: 'old_rev_cmp', sourceType: 'exam_session', sourceRef: 'sched_eot' }, components, examTypeOf)).toBe('cmp_eot');
  });

  it('keeps the recorded component when no component names the exam type', () => {
    expect(bridgedComponentId({ componentId: 'cmp_x', sourceType: 'exam_session', sourceRef: 'sched_other' }, components, examTypeOf)).toBe('cmp_x');
  });

  it('never re-binds non-exam evidence', () => {
    expect(bridgedComponentId({ componentId: 'cmp_ca', sourceType: 'homework', sourceRef: 'sched_eot' }, components, examTypeOf)).toBe('cmp_ca');
  });

  it('returns null for an unbound paper with no policy', () => {
    expect(bridgedComponentId({ componentId: null, sourceType: 'exam_session', sourceRef: 'sched_eot' }, undefined, examTypeOf)).toBeNull();
  });
});
