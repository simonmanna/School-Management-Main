import * as fs from 'fs';
import * as path from 'path';
import { ALL_PERMISSIONS } from '@erp/shared';

/**
 * Route-permission coverage invariant (Phase 4).
 *
 * The PermissionsGuard currently FAILS OPEN: an undecorated handler is allowed.
 * That is the legacy state across 1800+ handlers. Rather than flip the guard and
 * 403 the whole app, we make the gap EXPLICIT and MACHINE-CHECKED:
 *
 *   - Every controller handler must either carry @RequirePermissions, @Public,
 *     @NoPermissionRequired, @ScopedToStudent or @ScopedToClass, OR be listed in
 *     route-permission-exceptions.json with a reason.
 *   - Every entry in that JSON must STILL be a real gap. If a handler gets
 *     decorated, the spec fails until the JSON entry is removed — forcing a
 *     conscious decision (you closed the gap; acknowledge it). Deleting a gap
 *     silently is exactly what this guard-rails against.
 *
 * When the guard is eventually flipped to fail-closed (its own commit), this
 * ledger is the worklist: drain it to zero, then flip.
 */
const SRC = path.resolve(__dirname, '../../src');
const LEDGER = path.resolve(__dirname, './route-permission-exceptions.json');
const MARKERS = ['@RequirePermissions', '@Public', '@NoPermissionRequired', '@ScopedToStudent', '@ScopedToClass'];

function computeGaps(): Set<string> {
  const gaps = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      if (!entry.isFile() || !entry.name.endsWith('.controller.ts')) continue;
      const lines = fs.readFileSync(full, 'utf-8').split('\n');
      let cls: string | null = null;
      const rel = path.relative(SRC, full).replace(/\\/g, '/');
      for (let i = 0; i < lines.length; i++) {
        const cm = lines[i].match(/export class (\w+Controller)/);
        if (cm) cls = cm[1];
        if (!/^\s*@(Get|Post|Put|Patch|Delete|All|Options|Head)\s*(\(|$)/.test(lines[i])) continue;
        // Gather decorator lines both ABOVE and BELOW the HTTP-method decorator
        // (order is not guaranteed — @RequirePermissions may sit below @Get),
        // up to the method signature.
        let j = i;
        const block: string[] = [];
        while (j - 1 >= 0 && lines[j - 1].trim().startsWith('@')) {
          j -= 1;
          block.push(lines[j].trim());
        }
        let k = i;
        while (k + 1 < lines.length && lines[k + 1].trim().startsWith('@') && !/^\s*(?:async\s+)?\w+\s*\(/.test(lines[k + 1])) {
          k += 1;
          block.push(lines[k].trim());
        }
        const decorated = block.some((b) => MARKERS.some((mk) => b.includes(mk)));
        let name: string | null = null;
        for (let k = i; k < Math.min(i + 4, lines.length); k++) {
          const nm = lines[k].match(/^\s*(?:async\s+)?(\w+)\s*\(/);
          if (nm) { name = nm[1]; break; }
        }
        if (!decorated && name && name !== 'constructor' && cls) {
          gaps.add(`${rel}::${cls}#${name}`);
        }
      }
    }
  };
  walk(SRC);
  return gaps;
}

describe('route-permission coverage ledger', () => {
  const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf-8'));
  const ledgerKeys = new Set<string>();
  for (const [file, entries] of Object.entries<any>(ledger)) {
    for (const e of entries as Array<{ cls: string; method: string }>) {
      ledgerKeys.add(`${file}::${e.cls}#${e.method}`);
    }
  }

  it('every computed gap is recorded in the ledger', () => {
    const gaps = computeGaps();
    const missing = [...gaps].filter((g) => !ledgerKeys.has(g));
    expect(missing).toHaveLength(0);
  });

  it('every ledger entry is still a real gap (no stale entries)', () => {
    const gaps = computeGaps();
    const stale = [...ledgerKeys].filter((k) => !gaps.has(k));
    expect(stale).toHaveLength(0);
  });

  it('newly-gated kernel controllers are no longer gaps', () => {
    const mustBeGated = [
      'kernel/feature-flags/feature-flags.controller.ts::FeatureFlagsController#list',
      'kernel/feature-flags/feature-flags.controller.ts::FeatureFlagsController#set',
      'kernel/recurring/recurring.controller.ts::RecurringController#list',
      'kernel/search/search.controller.ts::SearchController#global',
      'kernel/files/files.controller.ts::FilesController#upload',
      'kernel/notifications/notifications.controller.ts::NotificationsController#test',
    ];
    const gaps = computeGaps();
    const stillOpen = mustBeGated.filter((k) => gaps.has(k));
    expect(stillOpen).toHaveLength(0);
  });

  it('the drift spec already guarantees every @RequirePermissions literal is a real key', () => {
    for (const k of ['feature_flag:read', 'feature_flag:write', 'recurring:read', 'recurring:write', 'search:read', 'school:documents:read', 'school:documents:write', 'setting:update']) {
      expect(ALL_PERMISSIONS).toContain(k);
    }
  });
});

