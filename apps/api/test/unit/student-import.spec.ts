import ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { parseCsv, parseStudentSheet } from '../../src/modules/school/people/student-import-parser';
import { StudentService } from '../../src/modules/school/people/student.service';

/** Import Students: file parsing for column mapping, and mapped-row admission. */
describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded newlines and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",z')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', 'z'],
    ]);
  });

  it('detects semicolon-delimited files', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('parseStudentSheet', () => {
  const csv = (text: string, name = 'pupils.csv') => ({ originalname: name, buffer: Buffer.from(text, 'utf8') });

  it('reads a CSV with BOM, skipping blank rows and naming blank/duplicate headings', async () => {
    const out = await parseStudentSheet(csv('﻿Adm No,Name,,Name\nA1,Jane,x,J\n,,,\nA2,Tom,,T\n'));
    expect(out.headers).toEqual(['Adm No', 'Name', 'Column 3', 'Name (2)']);
    expect(out.rows).toEqual([
      { 'Adm No': 'A1', Name: 'Jane', 'Column 3': 'x', 'Name (2)': 'J' },
      { 'Adm No': 'A2', Name: 'Tom', 'Column 3': '', 'Name (2)': 'T' },
    ]);
  });

  it('reads an .xlsx, turning date cells into ISO dates', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Pupils');
    ws.addRow(['Admission No', 'Full Name', 'DOB', 'Fees']);
    ws.addRow(['ADM-1', { richText: [{ text: 'Jane ' }, { text: 'Doe' }] }, new Date(Date.UTC(2015, 2, 9)), 1200]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const out = await parseStudentSheet({ originalname: 'p.xlsx', buffer });
    expect(out.sheetName).toBe('Pupils');
    expect(out.rows).toEqual([{ 'Admission No': 'ADM-1', 'Full Name': 'Jane Doe', DOB: '2015-03-09', Fees: '1200' }]);
  });

  it('refuses empty, header-only, unsupported and .xls files', async () => {
    await expect(parseStudentSheet(undefined)).rejects.toThrow(BadRequestException);
    await expect(parseStudentSheet(csv('Name,Adm\n'))).rejects.toThrow(/no pupil rows/);
    await expect(parseStudentSheet(csv('x', 'a.pdf'))).rejects.toThrow(/\.xlsx or \.csv/);
    await expect(parseStudentSheet(csv('x', 'a.xls'))).rejects.toThrow(/\.xls workbooks/);
  });
});

describe('StudentService.bulkImport (mapped rows)', () => {
  function service() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc: any = Object.create(StudentService.prototype);
    svc.prisma = {
      client: {
        customField: { findMany: jest.fn().mockResolvedValue([]) },
        schoolClass: { findFirst: jest.fn(async ({ where }: any) => (where.OR[1].name.equals === 'Primary Four' ? { id: 'c4' } : null)) },
        section: { findFirst: jest.fn().mockResolvedValue(null) },
        studentCategory: { findFirst: jest.fn(async ({ where }: any) => (where.name.equals === 'Bursary' ? { id: 'cat1' } : null)) },
      },
    };
    svc.create = jest.fn(async (dto: any) => ({ id: dto.admissionNo }));
    return svc;
  }

  it('builds the name from first + last, normalises gender/residence/dates and attaches the guardian', async () => {
    const svc = service();
    const res = await svc.bulkImport([
      {
        admissionno: 'A1', firstname: 'Jane', lastname: 'Doe', gender: 'F', residencetype: 'Boarding',
        dateofbirth: '9/3/2015', classcode: 'Primary Four', studentcategory: 'Bursary',
        guardianfirstname: 'John', guardianrelationship: 'Father', guardianphone: '0700',
      },
    ]);
    expect(res).toEqual({ created: 1, skipped: [] });
    expect(svc.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Jane Doe', gender: 'female', residenceType: 'boarder', dateOfBirth: '2015-03-09',
      classId: 'c4', studentCategoryId: 'cat1',
      guardians: [expect.objectContaining({ firstName: 'John', relationship: 'father', phone: '0700' })],
    }));
  });

  it('skips bad rows with a reason and keeps going', async () => {
    const svc = service();
    const res = await svc.bulkImport([
      { admissionno: 'A1' },
      { admissionno: 'A2', name: 'X', gender: 'q' },
      { admissionno: 'A3', name: 'Y', dateofbirth: '2015/13/45' },
      { admissionno: 'A4', name: 'Z', classcode: 'Nowhere' },
      { admissionno: 'A5', name: 'W', studentcategory: 'Missing' },
      { admissionno: 'A6', name: 'OK' },
    ]);
    expect(res.created).toBe(1);
    expect(res.skipped.map((s: { row: number; reason: string }) => [s.row, s.reason])).toEqual([
      [0, 'missing admission number or name'],
      [1, expect.stringContaining('Invalid gender')],
      [2, expect.stringContaining('Invalid date of birth')],
      [3, 'Unknown class "Nowhere".'],
      [4, 'Unknown student category "Missing".'],
    ]);
  });
});
