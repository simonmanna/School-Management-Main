import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  ACCOUNT_CATEGORY_BY_KEY,
  ACCOUNT_MAPPING_BY_KEY,
  ACCOUNT_MAPPING_REGISTRY,
  REQUIRED_ACCOUNT_MAPPING_KEYS,
  isCategoryValidForMapping,
} from '@erp/shared';
import { ACCOUNT_CATEGORY_SEED, COA_JOURNALS, COA_MAPPINGS, COA_TEMPLATE } from './coa-template';

/**
 * Guards against the drift that motivated this module: the shared mapping
 * catalog listed 23 keys while posting code used 37, and the two COA seeders
 * disagreed, so newly created orgs threw `Account mapping '<key>' is not
 * configured` on 16 keys the moment anyone made a sale.
 */
describe('COA template', () => {
  const accountByCode = new Map(COA_TEMPLATE.map((a) => [a.code, a]));

  it('references only known categories (or empty for header nodes)', () => {
    for (const a of COA_TEMPLATE) {
      if (!a.categoryKey) continue;
      expect(ACCOUNT_CATEGORY_BY_KEY[a.categoryKey]).toBeDefined();
    }
  });

  it('has unique account codes', () => {
    expect(accountByCode.size).toBe(COA_TEMPLATE.length);
  });

  it('resolves every parentCode, and every parent is non-postable (header)', () => {
    for (const a of COA_TEMPLATE) {
      if (!a.parentCode) continue;
      const parent = accountByCode.get(a.parentCode);
      expect(parent).toBeDefined();
      expect(parent!.isPostable).toBe(false);
    }
  });

  it('keeps children in the same classification as their parent', () => {
    for (const a of COA_TEMPLATE) {
      if (!a.parentCode) continue;
      const parent = accountByCode.get(a.parentCode)!;
      if (!a.categoryKey || !parent.categoryKey) continue;
      expect(ACCOUNT_CATEGORY_BY_KEY[a.categoryKey].classification).toBe(
        ACCOUNT_CATEGORY_BY_KEY[parent.categoryKey].classification,
      );
    }
  });

  it('has no parent cycles', () => {
    for (const a of COA_TEMPLATE) {
      const seen = new Set<string>([a.code]);
      let cursor = a.parentCode;
      while (cursor) {
        expect(seen.has(cursor)).toBe(false);
        seen.add(cursor);
        cursor = accountByCode.get(cursor)?.parentCode;
      }
    }
  });

  it('seeds an account for every required mapping key', () => {
    const missing = REQUIRED_ACCOUNT_MAPPING_KEYS.filter((k) => !COA_MAPPINGS[k]);
    expect(missing).toEqual([]);
  });

  // `wip` is required:false, so the generic "required key" guard above skips it —
  // which is exactly how it shipped mapped to no account, both production posting
  // legs collapsing onto stock_valuation. This is the explicit regression guard:
  // it must resolve to a work_in_progress account the resolver will accept.
  it('maps wip to a work_in_progress account the resolver accepts', () => {
    const code = COA_MAPPINGS['wip'];
    expect(code).toBeDefined();
    const account = accountByCode.get(code);
    expect(account).toBeDefined();
    expect(account!.categoryKey).toBe('work_in_progress');
    expect(isCategoryValidForMapping('wip', account!.categoryKey!)).toBe(true);
  });

  it('maps every key to an account that exists in the template', () => {
    for (const [key, code] of Object.entries(COA_MAPPINGS)) {
      expect(accountByCode.has(code)).toBe(true);
      expect(ACCOUNT_MAPPING_BY_KEY[key]).toBeDefined();
    }
  });

  it('maps every key to an account of an expected category', () => {
    const violations: string[] = [];
    for (const [key, code] of Object.entries(COA_MAPPINGS)) {
      const account = accountByCode.get(code)!;
      // A mapped account with no category cannot be validated at all — and would
      // post against an account whose accounting behavior is undefined. Treat it
      // as a violation rather than skipping it.
      if (!account.categoryKey) {
        violations.push(`${key} -> ${code} has no categoryKey`);
        continue;
      }
      if (!isCategoryValidForMapping(key, account.categoryKey)) {
        violations.push(
          `${key} -> ${code} (${account.categoryKey}); expected one of ` +
            ACCOUNT_MAPPING_BY_KEY[key].expectedCategories.join(', '),
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it('resolves every journal defaultDebitCode', () => {
    for (const j of COA_JOURNALS) {
      if (j.defaultDebitCode) expect(accountByCode.has(j.defaultDebitCode)).toBe(true);
    }
  });

});

describe('account mapping registry', () => {
  /** Every `mapped('<key>')` / `byMapping('<key>')` literal in the API source. */
  function collectMappingLiterals(): Map<string, string[]> {
    const found = new Map<string, string[]>();
    const root = join(__dirname, '..', '..', '..');
    const pattern = /\b(?:mapped|byMapping|byMappingOptional)\(\s*'([a-z0-9_]+)'/g;

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== 'node_modules') walk(full);
          continue;
        }
        if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
        const src = readFileSync(full, 'utf8');
        let m: RegExpExecArray | null;
        pattern.lastIndex = 0;
        while ((m = pattern.exec(src)) !== null) {
          const list = found.get(m[1]) ?? [];
          list.push(full);
          found.set(m[1], list);
        }
      }
    };
    walk(root);
    return found;
  }

  it('has unique keys', () => {
    const keys = ACCOUNT_MAPPING_REGISTRY.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('lists only known categories in expectedCategories', () => {
    for (const def of ACCOUNT_MAPPING_REGISTRY) {
      for (const key of def.expectedCategories) {
        expect(ACCOUNT_CATEGORY_BY_KEY[key]).toBeDefined();
      }
    }
  });

  it('contains every mapping key used by posting code', () => {
    const used = collectMappingLiterals();
    const unknown = [...used.entries()]
      .filter(([key]) => !ACCOUNT_MAPPING_BY_KEY[key])
      .map(([key, files]) => `${key} (used in ${files[0]})`);
    expect(unknown).toEqual([]);
  });
});
