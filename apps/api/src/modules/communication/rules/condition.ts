import { TemplateRenderService } from './template-render.service';

/**
 * A tiny, safe JSON predicate evaluated against an event payload. No code, no
 * regex from config — just comparison operators, so a rule condition authored in
 * the admin UI can never do anything but compare payload fields.
 *
 * Shape: `{ "<path>": <matcher> }` where `<matcher>` is either a literal (⇒ `$eq`)
 * or `{ "$op": <operand> }`. An operand may be a literal or `{ "$field": "<path>" }`
 * to compare one payload field against another.
 *
 *   {}                                             → always true
 *   { "status": "paid" }                           → payload.status === 'paid'
 *   { "total": { "$gte": 100 } }                   → payload.total >= 100
 *   { "quantity": { "$lt": { "$field": "minimum" } } } → payload.quantity < payload.minimum
 *
 * Multiple keys are AND-ed. Unknown operators fail closed (no match) so a
 * malformed rule never spams.
 */
export type Condition = Record<string, unknown>;

export function matchesCondition(condition: Condition, payload: Record<string, unknown>): boolean {
  if (!condition || typeof condition !== 'object') return true;
  const keys = Object.keys(condition);
  if (keys.length === 0) return true;

  return keys.every((path) => {
    const matcher = condition[path];
    const actual = TemplateRenderService.resolvePath(payload, path);
    if (matcher !== null && typeof matcher === 'object' && !Array.isArray(matcher)) {
      return matchOperators(actual, matcher as Record<string, unknown>, payload);
    }
    // Bare literal ⇒ equality.
    return actual === matcher;
  });
}

function matchOperators(actual: unknown, ops: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  return Object.entries(ops).every(([op, rawOperand]) => {
    const operand = resolveOperand(rawOperand, payload);
    switch (op) {
      case '$eq':
        return actual === operand;
      case '$ne':
        return actual !== operand;
      case '$gt':
        return num(actual) > num(operand);
      case '$gte':
        return num(actual) >= num(operand);
      case '$lt':
        return num(actual) < num(operand);
      case '$lte':
        return num(actual) <= num(operand);
      case '$in':
        return Array.isArray(operand) && operand.includes(actual as never);
      case '$exists':
        return (actual !== undefined && actual !== null) === Boolean(operand);
      default:
        return false; // unknown operator → fail closed
    }
  });
}

/** `{ "$field": "path" }` reads another payload field; anything else is a literal. */
function resolveOperand(operand: unknown, payload: Record<string, unknown>): unknown {
  if (operand && typeof operand === 'object' && !Array.isArray(operand) && '$field' in (operand as object)) {
    return TemplateRenderService.resolvePath(payload, String((operand as Record<string, unknown>).$field));
  }
  return operand;
}

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}
