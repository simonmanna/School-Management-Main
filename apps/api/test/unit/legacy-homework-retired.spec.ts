import { GoneException } from '@nestjs/common';
import { HomeworkController, SubmissionController } from '../../src/modules/school/lms/lms.controller';

/**
 * Audit 2026-09-29 A01 (P0): an unassigned Class Teacher, refused the pupil
 * record itself, still read that pupil's retained homework — content, score,
 * feedback, attachments — through the legacy routes, which checked only
 * `school:read`. Every legacy homework and submission route is retired: it
 * answers 410 for every caller and reads nothing. (A06, the submission list's
 * 500, went with it.)
 */
describe('legacy homework routes are retired (A01)', () => {
  const cases: Array<[string, object]> = [
    ['HomeworkController', new (HomeworkController as any)()],
    ['SubmissionController', new (SubmissionController as any)()],
  ];

  for (const [name, controller] of cases) {
    const handlers = Object.getOwnPropertyNames(Object.getPrototypeOf(controller)).filter((h) => h !== 'constructor');

    it(`${name} has no injected services to read with`, () => {
      expect((name === 'HomeworkController' ? HomeworkController : SubmissionController).length).toBe(0);
    });

    for (const h of handlers) {
      it(`${name}#${h} answers 410 Gone`, () => {
        expect(() => (controller as any)[h]('any-id', {})).toThrow(GoneException);
      });
    }
  }

  it('covers every read the audit reproduced', () => {
    const hw = Object.getOwnPropertyNames(HomeworkController.prototype);
    const sub = Object.getOwnPropertyNames(SubmissionController.prototype);
    expect(hw).toEqual(expect.arrayContaining(['list', 'byClass', 'findOne', 'detail']));
    expect(sub).toEqual(expect.arrayContaining(['list', 'findOne']));
  });
});
