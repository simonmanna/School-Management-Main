/**
 * Unit tests for the report card settings field registry.
 *
 * The registry is the validation boundary between the browser and the
 * `config` JSONB blob: anything it lets through is written to the database
 * unchecked and then fed straight into the PDF renderer. These tests pin the
 * behaviour that keeps that safe — unknown keys dropped, enums closed, numbers
 * clamped, colours hex-only, and ordered lists reconciled against the catalog
 * so a stale client can never delete a column or unlock a locked one.
 */
import {
  DEFAULTS,
  FIELDS,
  FIELD_BY_KEY,
  GROUPS,
  PRESETS,
  coerceField,
  groupDefaults,
  presetSettings,
  resolveSettings,
  sanitizePatch,
  type ColumnItem,
} from '../../src/modules/school/examinations/report-card-settings.schema';

describe('report card settings registry', () => {
  describe('registry integrity', () => {
    it('has no duplicate field keys', () => {
      const keys = FIELDS.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('assigns every field to a declared group', () => {
      const groups = new Set(GROUPS.map((g) => g.key));
      for (const f of FIELDS) expect(groups.has(f.group)).toBe(true);
    });

    it('gives every field a default that survives its own coercion', () => {
      for (const f of FIELDS) {
        expect(coerceField(f, f.default)).not.toBeUndefined();
      }
    });

    it('only points showIf at fields that exist', () => {
      for (const f of FIELDS) {
        if (f.showIf) expect(FIELD_BY_KEY[f.showIf.key]).toBeDefined();
      }
    });

    it('only overrides real fields from presets', () => {
      for (const p of PRESETS) {
        for (const key of Object.keys(p.overrides)) {
          expect(FIELD_BY_KEY[key]).toBeDefined();
        }
      }
    });
  });

  describe('sanitizePatch', () => {
    it('drops keys that are not in the registry', () => {
      expect(sanitizePatch({ showWatermark: true, dropTables: 'yes', __proto__: {} })).toEqual({ showWatermark: true });
    });

    it('drops values that cannot be coerced, leaving the stored value intact', () => {
      // A bad colour must not blank the field — the key is simply omitted.
      expect(sanitizePatch({ accentColor: 'red', schoolNameColor: '#ABCDEF' })).toEqual({ schoolNameColor: '#abcdef' });
    });

    it('accepts an empty patch', () => {
      expect(sanitizePatch({})).toEqual({});
    });
  });

  describe('coerceField', () => {
    const field = (key: string) => FIELD_BY_KEY[key];

    it('clamps numbers into the declared range', () => {
      expect(coerceField(field('baseFontSize'), 999)).toBe(14);
      expect(coerceField(field('baseFontSize'), -5)).toBe(6);
      expect(coerceField(field('baseFontSize'), 10)).toBe(10);
    });

    it('rejects non-numeric input rather than coercing it to zero', () => {
      expect(coerceField(field('baseFontSize'), 'huge')).toBeUndefined();
    });

    it('accepts only hex colours, normalised to lower case', () => {
      expect(coerceField(field('accentColor'), '#AABBCC')).toBe('#aabbcc');
      expect(coerceField(field('accentColor'), '#abc')).toBe('#abc');
      expect(coerceField(field('accentColor'), 'rgb(0,0,0)')).toBeUndefined();
      expect(coerceField(field('accentColor'), '#12345')).toBeUndefined();
    });

    it('closes select fields to their declared options', () => {
      expect(coerceField(field('pageSize'), 'A5')).toBe('A5');
      expect(coerceField(field('pageSize'), 'A3')).toBeUndefined();
    });

    it('accepts booleans and their string forms only', () => {
      expect(coerceField(field('showWatermark'), true)).toBe(true);
      expect(coerceField(field('showWatermark'), 'false')).toBe(false);
      expect(coerceField(field('showWatermark'), 1)).toBeUndefined();
    });

    it('keeps lists to strings and caps their length', () => {
      expect(coerceField(field('footerLines'), ['a', 2, null, 'b'])).toEqual(['a', 'b']);
      expect((coerceField(field('conductTraits'), Array(50).fill('x')) as string[]).length).toBe(20);
      expect(coerceField(field('footerLines'), 'not a list')).toBeUndefined();
    });

    it('truncates over-long text rather than rejecting it', () => {
      expect((coerceField(field('reportTitle'), 'x'.repeat(500)) as string).length).toBe(200);
    });
  });

  describe('coerceField — ordered column lists', () => {
    const def = FIELD_BY_KEY.tableColumns;
    const catalog = def.default as ColumnItem[];

    it('preserves the order the client sent', () => {
      const sent = [
        { key: 'grade', label: 'Grade', enabled: true },
        { key: 'subject', label: 'Subject', enabled: true },
      ];
      const out = coerceField(def, sent) as ColumnItem[];
      expect(out[0].key).toBe('grade');
      expect(out[1].key).toBe('subject');
    });

    it('appends omitted catalog entries as disabled instead of deleting them', () => {
      const out = coerceField(def, [{ key: 'subject', label: 'Subject', enabled: true }]) as ColumnItem[];
      expect(out.length).toBe(catalog.length);
      expect(out.filter((c) => c.enabled).map((c) => c.key)).toEqual(['subject']);
    });

    it('drops unknown and duplicated keys', () => {
      const out = coerceField(def, [
        { key: 'subject', label: 'Subject', enabled: true },
        { key: 'subject', label: 'Dupe', enabled: true },
        { key: 'evil', label: 'Injected', enabled: true },
      ]) as ColumnItem[];
      expect(out.filter((c) => c.key === 'subject').length).toBe(1);
      expect(out.some((c) => c.key === 'evil')).toBe(false);
    });

    it('refuses to disable a locked column', () => {
      const out = coerceField(def, [{ key: 'subject', label: 'Subject', enabled: false }]) as ColumnItem[];
      expect(out.find((c) => c.key === 'subject')!.enabled).toBe(true);
    });

    it('falls back to the catalog label when the client sends a blank one', () => {
      const out = coerceField(def, [{ key: 'subject', label: '   ', enabled: true }]) as ColumnItem[];
      expect(out.find((c) => c.key === 'subject')!.label).toBe('Subject');
    });

    it('rejects a non-array', () => {
      expect(coerceField(def, { subject: true })).toBeUndefined();
    });
  });

  describe('resolveSettings', () => {
    it('fills every registry key when nothing is stored', () => {
      const resolved = resolveSettings({});
      for (const f of FIELDS) expect(resolved[f.key]).toEqual(DEFAULTS[f.key]);
    });

    it('replaces stored values that have drifted out of range', () => {
      // A row written before a range tightened must not leak a bad value.
      expect(resolveSettings({ baseFontSize: 900 }).baseFontSize).toBe(14);
      expect(resolveSettings({ pageSize: 'A3' }).pageSize).toBe('A4');
      expect(resolveSettings({ accentColor: null }).accentColor).toBe(DEFAULTS.accentColor);
    });

    it('does not hand out shared references to the default objects', () => {
      const a = resolveSettings({}) as { tableColumns: ColumnItem[] };
      const b = resolveSettings({}) as { tableColumns: ColumnItem[] };
      a.tableColumns[0].enabled = !a.tableColumns[0].enabled;
      expect(b.tableColumns[0].enabled).not.toBe(a.tableColumns[0].enabled);
    });
  });

  describe('presets', () => {
    it('produces a complete settings object for each preset', () => {
      for (const p of PRESETS) {
        const settings = presetSettings(p.key)!;
        expect(settings).toBeTruthy();
        for (const f of FIELDS) expect(settings[f.key]).not.toBeUndefined();
      }
    });

    it('applies its own overrides', () => {
      expect(presetSettings('minimal')!.pageBorder).toBe('none');
      expect(presetSettings('classic')!.fontFamily).toBe('times');
      expect(presetSettings('formal')!.showWatermark).toBe(true);
    });

    it('resets fields the preset does not mention back to the default', () => {
      // Presets are absolute, not cumulative — 'modern' says nothing about
      // conduct traits, so they must come back as the registry default.
      expect(presetSettings('modern')!.conductTraits).toEqual(DEFAULTS.conductTraits);
    });

    it('returns null for an unknown preset', () => {
      expect(presetSettings('nope')).toBeNull();
    });
  });

  describe('groupDefaults', () => {
    it('returns exactly the fields of that group', () => {
      const paper = groupDefaults('paper');
      const expected = FIELDS.filter((f) => f.group === 'paper').map((f) => f.key).sort();
      expect(Object.keys(paper).sort()).toEqual(expected);
    });

    it('covers every group without overlap', () => {
      const seen = new Set<string>();
      for (const g of GROUPS) {
        for (const key of Object.keys(groupDefaults(g.key))) {
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
      expect(seen.size).toBe(FIELDS.length);
    });
  });
});
