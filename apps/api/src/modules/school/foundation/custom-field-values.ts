import { BadRequestException } from '@nestjs/common';

/**
 * Wave 16 — values for the school's own custom fields.
 *
 * `CustomField` rows let a school add "Blood group", "Religion", "Bus stop"…
 * to a pupil or guardian, but nothing checked the values against them: a
 * "number" field took "abc", a required field could be left out, a select took
 * anything. The definitions now mean something — at the API, not only in the
 * form, so a script or an import cannot bypass them.
 *
 * Only DEFINED keys are checked and normalised. Every other key in the bag is
 * passed through untouched: `customFields` also carries system values (NIN
 * ciphertext, photo, middle name…) that must never be dropped by this.
 */

export interface CustomFieldDefinition {
  name: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
}

export async function loadCustomFieldDefinitions(client: any, entityType: string): Promise<CustomFieldDefinition[]> {
  return client.customField.findMany({
    where: { entityType, active: true, deletedAt: null },
    orderBy: [{ order: 'asc' }, { label: 'asc' }],
    select: { name: true, label: true, type: true, options: true, required: true },
  });
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Check and normalise `values` against `defs`.
 *  - `requireAll` (create): every required field must have a value.
 *  - otherwise (update): only fields present are checked, but a required field
 *    cannot be cleared.
 * Returns a new object; throws one BadRequest naming every problem.
 */
export function validateCustomFieldValues(
  defs: CustomFieldDefinition[],
  values: Record<string, unknown> | undefined | null,
  opts: { requireAll: boolean },
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(values ?? {}) };
  const problems: string[] = [];
  for (const d of defs) {
    const present = Object.prototype.hasOwnProperty.call(out, d.name);
    const v = out[d.name];
    if (blank(v)) {
      if (d.required && (opts.requireAll || present)) problems.push(`${d.label} is required`);
      if (present) out[d.name] = null;
      continue;
    }
    switch (d.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(String(v).trim());
        if (!Number.isFinite(n)) problems.push(`${d.label} must be a number`);
        else out[d.name] = n;
        break;
      }
      case 'date': {
        const s = String(v).trim();
        if (!/^\d{4}-\d{2}-\d{2}/.test(s) || Number.isNaN(new Date(s).getTime())) problems.push(`${d.label} must be a date (YYYY-MM-DD)`);
        else out[d.name] = s.slice(0, 10);
        break;
      }
      case 'boolean': {
        if (typeof v === 'boolean') break;
        const s = String(v).toLowerCase();
        if (['true', 'yes', '1'].includes(s)) out[d.name] = true;
        else if (['false', 'no', '0'].includes(s)) out[d.name] = false;
        else problems.push(`${d.label} must be yes or no`);
        break;
      }
      case 'select': {
        const s = String(v);
        if (d.options.length && !d.options.includes(s)) problems.push(`${d.label} must be one of: ${d.options.join(', ')}`);
        break;
      }
      default: {
        const s = String(v);
        if (s.length > 2000) problems.push(`${d.label} is too long`);
        else out[d.name] = s.trim();
      }
    }
  }
  if (problems.length) throw new BadRequestException(problems.join('; '));
  return out;
}
