/**
 * H2/B6 — proves the newly class-validated DTOs across the school modules reject
 * bad input. These endpoints were bare interfaces (no runtime validation) before
 * the conversion; this exercises the metadata the global ValidationPipe reads.
 */
import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateStudentDto } from '../../src/modules/school/people/dto.types';
import { EnrollApplicationDto } from '../../src/modules/school/admissions/dto.types';
import { BulkMarkAttendanceDto } from '../../src/modules/school/attendance/dto.types';
import { BulkGradeEntryDto, CreateGradingScaleDto } from '../../src/modules/school/examinations/dto.types';
import { CreateTimetableSlotDto } from '../../src/modules/school/academics/dto.types';

const errs = (o: object) => validateSync(o, { whitelist: true });
const props = (o: object) => errs(o).map((e) => e.property);

describe('People — CreateStudentDto', () => {
  it('accepts a valid student', () => {
    const d = plainToInstance(CreateStudentDto, { name: 'Ada', admissionNo: 'A1', enrollmentDate: '2026-01-10', gender: 'female' });
    expect(errs(d)).toHaveLength(0);
  });
  it('requires name + admissionNo + enrollmentDate', () => {
    const d = plainToInstance(CreateStudentDto, {});
    expect(props(d)).toEqual(expect.arrayContaining(['name', 'admissionNo', 'enrollmentDate']));
  });
  it('rejects a bad gender enum', () => {
    const d = plainToInstance(CreateStudentDto, { name: 'Ada', admissionNo: 'A1', enrollmentDate: '2026-01-10', gender: 'x' });
    expect(props(d)).toContain('gender');
  });
});

describe('Admissions — EnrollApplicationDto (nested student)', () => {
  it('accepts a valid enrollment', () => {
    const d = plainToInstance(EnrollApplicationDto, {
      applicationId: 'app1', classId: 'c1', termId: 't1', rollNumber: '5', student: { name: 'Ada' },
    });
    expect(errs(d)).toHaveLength(0);
  });
  it('validates the nested student (missing name)', () => {
    const d = plainToInstance(EnrollApplicationDto, {
      applicationId: 'app1', classId: 'c1', termId: 't1', rollNumber: '5', student: {},
    });
    expect(errs(d).length).toBeGreaterThan(0);
  });
});

describe('Attendance — BulkMarkAttendanceDto (nested entries)', () => {
  it('rejects an invalid entry status', () => {
    const d = plainToInstance(BulkMarkAttendanceDto, {
      date: '2026-02-02', classId: 'c1', entries: [{ studentProfileId: 's1', status: 'maybe' }],
    });
    expect(errs(d).length).toBeGreaterThan(0);
  });
  it('accepts valid entries', () => {
    const d = plainToInstance(BulkMarkAttendanceDto, {
      date: '2026-02-02', classId: 'c1', entries: [{ studentProfileId: 's1', status: 'present' }],
    });
    expect(errs(d)).toHaveLength(0);
  });
});

describe('Examinations', () => {
  it('BulkGradeEntryDto rejects a negative mark', () => {
    const d = plainToInstance(BulkGradeEntryDto, {
      examScheduleId: 'e1', entries: [{ studentProfileId: 's1', marksObtained: -1 }],
    });
    expect(errs(d).length).toBeGreaterThan(0);
  });
  it('CreateGradingScaleDto validates nested bands', () => {
    const d = plainToInstance(CreateGradingScaleDto, { name: 'UCE', bands: [{ min: 0, max: 39, grade: 'F', gpa: 0 }] });
    expect(errs(d)).toHaveLength(0);
  });
});

describe('Academics — CreateTimetableSlotDto', () => {
  it('rejects a dayOfWeek outside 1..7', () => {
    const d = plainToInstance(CreateTimetableSlotDto, { classId: 'c1', dayOfWeek: 9, periodId: 'p1', subjectId: 'sub1' });
    expect(props(d)).toContain('dayOfWeek');
  });
});
