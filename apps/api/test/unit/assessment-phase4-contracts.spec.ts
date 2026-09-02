import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BulkBoardMarksDto, CreateUnifiedAssessmentDto, AssessmentLifecycleDto } from '../../src/modules/school/assessment/assessment-board.dto';
import { hasOutcome } from '../../src/modules/school/assessment/assessment-workflow.service';

describe('Phase 4 HTTP and participation contracts', () => {
  const row = { studentProfileId: 'learner', marks: 0, participation: 'present', expectedVersion: 0 };
  it('accepts a genuine zero without treating it as missing', async () => {
    expect(await validate(plainToInstance(BulkBoardMarksDto, { rows: [row] }))).toHaveLength(0);
    expect(hasOutcome({ marks: 0, participation: 'present' })).toBe(true);
    expect(hasOutcome({ marks: null, participation: 'missing' })).toBe(false);
    expect(hasOutcome({ marks: null, participation: 'withdrawn' })).toBe(true);
  });
  it.each([undefined, null, -1, 0.5, '0'])('requires a valid optimistic version: %s', async (expectedVersion) => {
    expect((await validate(plainToInstance(BulkBoardMarksDto, { rows: [{ ...row, expectedVersion }] }))).length).toBeGreaterThan(0);
  });
  it('rejects empty and oversized batches', async () => {
    for (const rows of [[], Array.from({ length: 501 }, () => row)]) expect((await validate(plainToInstance(BulkBoardMarksDto, { rows }))).length).toBeGreaterThan(0);
  });
  it('does not allow a non-finite score or unknown participation', async () => {
    for (const change of [{ marks: Infinity }, { marks: NaN }, { participation: 'unknown' }]) expect((await validate(plainToInstance(BulkBoardMarksDto, { rows: [{ ...row, ...change }] }))).length).toBeGreaterThan(0);
  });
  it('requires canonical references and validates lifecycle versions', async () => {
    expect((await validate(plainToInstance(CreateUnifiedAssessmentDto, { title: 'CAT', kind: 'cat', termId: 'term' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(AssessmentLifecycleDto, { action: 'publish' }))).length).toBeGreaterThan(0);
  });
});
