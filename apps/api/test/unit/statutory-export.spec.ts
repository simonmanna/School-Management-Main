/**
 * Unit — the rules a board actually rejects a file over.
 *
 * These are the failures that cost a school a submission window: a comma in a
 * learner's name that splits a row, a date in the wrong order, a score written
 * to two decimals where the layout allows one, a column that was renamed
 * between circulars. None of them need a database to be wrong, so none of them
 * need one to be caught.
 */
import { applyTransform, escapeCell, renderCell, renderCsv, validateColumns } from '../../src/modules/school/statutory/statutory-csv';
import { DEFAULT_TEMPLATES, STATUTORY_DATASETS } from '../../src/modules/school/statutory/statutory.datasets';
import { splitName } from '../../src/modules/school/statutory/uneb-ca.service';

describe('statutory export rendering', () => {
  describe('transforms', () => {
    it('writes a date of birth day-first, which is the order the register uses', () => {
      expect(applyTransform(new Date(Date.UTC(2011, 2, 7)), 'date_ddmmyyyy')).toBe('07/03/2011');
    });

    it('defaults a date to ISO rather than a locale string', () => {
      expect(applyTransform(new Date(Date.UTC(2011, 2, 7)), 'none')).toBe('2011-03-07');
    });

    it('holds a CA score to one decimal', () => {
      expect(applyTransform(73.456, 'one_decimal')).toBe('73.5');
      expect(applyTransform(73, 'one_decimal')).toBe('73.0');
    });

    it('rounds a position to a whole number', () => {
      expect(applyTransform(4.6, 'integer')).toBe('5');
    });

    it('leaves a non-numeric value alone rather than emitting NaN', () => {
      expect(applyTransform('absent', 'one_decimal')).toBe('absent');
      expect(applyTransform('n/a', 'integer')).toBe('n/a');
    });

    it('upper-cases names, because the board files are upper-case', () => {
      expect(applyTransform('nakato sarah', 'upper')).toBe('NAKATO SARAH');
    });
  });

  describe('cells', () => {
    const column = { header: 'SEX', source: 'sex', fallback: 'U', transform: 'upper' as const };

    it('uses the fallback when the value is missing', () => {
      expect(renderCell({ sex: null }, column)).toBe('U');
      expect(renderCell({ sex: '' }, column)).toBe('U');
      expect(renderCell({}, column)).toBe('U');
    });

    it('does not use the fallback for a legitimate zero', () => {
      expect(renderCell({ caTotal: 0 }, { header: 'CA', source: 'caTotal', fallback: '-', transform: 'one_decimal' })).toBe('0.0');
    });
  });

  describe('csv', () => {
    const columns = [
      { header: 'CANDIDATE_NO', source: 'candidateNumber' },
      { header: 'NAME', source: 'studentName' },
      { header: 'SCORE', source: 'score', transform: 'one_decimal' as const },
    ];

    it('quotes a value containing the delimiter so the row keeps its shape', () => {
      const csv = renderCsv([{ candidateNumber: '001', studentName: 'Okot, Peter', score: 62 }], columns);
      expect(csv).toContain('"Okot, Peter"');
      expect(csv.trim().split('\r\n')[1].split(',').length).toBeGreaterThan(3); // proof the naive split breaks
    });

    it('doubles embedded quotes rather than truncating the field', () => {
      const csv = renderCsv([{ candidateNumber: '001', studentName: 'Ann "Nanna" Aine', score: 1 }], columns);
      expect(csv).toContain('"Ann ""Nanna"" Aine"');
    });

    it('ends lines with CRLF, which the board upload tools expect', () => {
      const csv = renderCsv([{ candidateNumber: '001', studentName: 'A', score: 1 }], columns);
      expect(csv.endsWith('\r\n')).toBe(true);
      expect(csv.split('\r\n')).toHaveLength(3); // header, row, trailing empty
    });

    it('omits the header when the layout says so', () => {
      const csv = renderCsv([{ candidateNumber: '001', studentName: 'A', score: 1 }], columns, ',', false);
      expect(csv.startsWith('CANDIDATE_NO')).toBe(false);
    });

    it('honours a non-comma delimiter without quoting every field', () => {
      const csv = renderCsv([{ candidateNumber: '001', studentName: 'Okot, Peter', score: 1 }], columns, '|');
      // The comma is no longer a delimiter, so it needs no quoting.
      expect(csv).toContain('001|Okot, Peter|1.0');
    });

    it('neutralises a value that a spreadsheet would treat as a formula', () => {
      const csv = renderCsv([{ candidateNumber: '001', studentName: '=cmd|calc', score: 1 }], columns);
      expect(csv).toContain("'=cmd|calc");
      expect(csv).not.toMatch(/,=cmd/);
    });

    it('renders nothing but a header for an empty result, not a broken file', () => {
      expect(renderCsv([], columns)).toBe('CANDIDATE_NO,NAME,SCORE\r\n');
    });
  });

  describe('escapeCell', () => {
    it('quotes a newline so one learner cannot become two rows', () => {
      expect(escapeCell('line1\nline2', ',')).toBe('"line1\nline2"');
    });
  });

  describe('column validation', () => {
    it('refuses a field the dataset does not carry', () => {
      const problems = validateColumns('uneb_ca', [{ header: 'X', source: 'homeAddress' }]);
      expect(problems.join(' ')).toContain('homeAddress');
    });

    it('refuses two columns with the same heading', () => {
      const problems = validateColumns('uneb_ca', [
        { header: 'NAME', source: 'studentName' },
        { header: 'name', source: 'surname' },
      ]);
      expect(problems.join(' ')).toContain('Duplicate');
    });

    it('refuses an unknown dataset outright', () => {
      expect(validateColumns('not_a_scope', [])).toHaveLength(1);
    });

    it('accepts every shipped default layout', () => {
      for (const template of DEFAULT_TEMPLATES) {
        expect(validateColumns(template.scope, template.columns)).toEqual([]);
      }
    });
  });

  describe('dataset registry', () => {
    it('names every dataset its default templates target', () => {
      for (const template of DEFAULT_TEMPLATES) {
        expect(STATUTORY_DATASETS[template.scope]).toBeDefined();
      }
    });

    it('never repeats a field key inside one dataset', () => {
      for (const dataset of Object.values(STATUTORY_DATASETS)) {
        const keys = dataset.fields.map((f) => f.key);
        expect(new Set(keys).size).toBe(keys.length);
      }
    });
  });

  describe('name splitting', () => {
    it('takes the first token as the surname, which is the register order', () => {
      expect(splitName('Nakato Sarah Grace')).toEqual({ surname: 'Nakato', otherNames: 'Sarah Grace' });
    });

    it('survives a single-word name', () => {
      expect(splitName('Nakato')).toEqual({ surname: 'Nakato', otherNames: '' });
    });

    it('survives no name at all rather than throwing mid-export', () => {
      expect(splitName(null)).toEqual({ surname: '', otherNames: '' });
    });

    it('collapses double spacing rather than producing an empty surname', () => {
      expect(splitName('  Okot   Peter ')).toEqual({ surname: 'Okot', otherNames: 'Peter' });
    });

    /**
     * Registers are written both ways. The comma form must not leave the
     * surname as "Nakato," — a trailing comma has to be quoted in the file, and
     * board parsers have rejected that.
     */
    it('reads the comma form the way a register means it', () => {
      expect(splitName('Nakato, Ada Grace')).toEqual({ surname: 'Nakato', otherNames: 'Ada Grace' });
      expect(splitName('Okot ,  Peter')).toEqual({ surname: 'Okot', otherNames: 'Peter' });
    });
  });
});
