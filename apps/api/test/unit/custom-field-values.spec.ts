import { validateCustomFieldValues, type CustomFieldDefinition } from '../../src/modules/school/foundation/custom-field-values';

const defs: CustomFieldDefinition[] = [
  { name: 'bloodGroup', label: 'Blood group', type: 'select', options: ['A', 'B', 'AB', 'O'], required: true },
  { name: 'siblings', label: 'Siblings in school', type: 'number', options: [], required: false },
  { name: 'lastDewormed', label: 'Last dewormed', type: 'date', options: [], required: false },
  { name: 'usesBus', label: 'Uses the school bus', type: 'boolean', options: [], required: false },
];

describe('custom field values (Wave 16)', () => {
  it('normalises defined values and keeps undefined system keys untouched', () => {
    const out = validateCustomFieldValues(
      defs,
      { bloodGroup: 'O', siblings: '2', lastDewormed: '2026-03-01T10:00:00Z', usesBus: 'yes', ninEncrypted: { c: 'x' }, middleName: 'Grace' },
      { requireAll: true },
    );
    expect(out).toEqual({ bloodGroup: 'O', siblings: 2, lastDewormed: '2026-03-01', usesBus: true, ninEncrypted: { c: 'x' }, middleName: 'Grace' });
  });

  it('requires required fields on create, naming every problem at once', () => {
    expect(() => validateCustomFieldValues(defs, { siblings: 'many' }, { requireAll: true })).toThrow(
      'Blood group is required; Siblings in school must be a number',
    );
  });

  it('on update checks only what is sent, but a required field cannot be cleared', () => {
    expect(validateCustomFieldValues(defs, { siblings: 3 }, { requireAll: false })).toEqual({ siblings: 3 });
    expect(() => validateCustomFieldValues(defs, { bloodGroup: '' }, { requireAll: false })).toThrow('Blood group is required');
  });

  it('refuses a select value that is not an option, and a bad date', () => {
    expect(() => validateCustomFieldValues(defs, { bloodGroup: 'Z', lastDewormed: 'last week' }, { requireAll: false })).toThrow(
      'Blood group must be one of: A, B, AB, O; Last dewormed must be a date (YYYY-MM-DD)',
    );
  });
});
