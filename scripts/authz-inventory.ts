#!/usr/bin/env ts-node
/**
 * Phase 0 — authorization inventory.
 *
 * Scans every *.controller.ts under apps/api/src and reports handlers that are
 * NOT explicitly gated by @RequirePermissions / @Public / @NoPermissionRequired
 * / @ScopedToStudent / @ScopedToClass. Writes the result to
 * test/unit/route-permission-exceptions.json — the worklist the route-coverage
 * spec enforces.
 *
 * Run:  npx ts-node scripts/authz-inventory.ts
 * (or)  npm run authz:inventory
 *
 * The PermissionsGuard still FAILS OPEN today, so this is a measurement tool, not
 * an enforcement point. When the guard is flipped to fail-closed, draining this
 * JSON to zero is the migration checklist.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../apps/api/src');
const OUT = path.resolve(__dirname, '../apps/api/test/unit/route-permission-exceptions.json');
const MARKERS = ['@RequirePermissions', '@Public', '@NoPermissionRequired', '@ScopedToStudent', '@ScopedToClass'];

function scan(): Record<string, Array<{ cls: string; method: string; reason: string }>> {
  const out: Record<string, Array<{ cls: string; method: string; reason: string }>> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.controller.ts')) continue;
      const lines = fs.readFileSync(full, 'utf-8').split('\n');
      const rel = path.relative(SRC, full).replace(/\\/g, '/');
      let cls: string | null = null;
      for (let i = 0; i < lines.length; i++) {
        const cm = lines[i].match(/export class (\w+Controller)/);
        if (cm) cls = cm[1];
        if (!/^\s*@(Get|Post|Put|Patch|Delete|All|Options|Head)\s*(\(|$)/.test(lines[i])) continue;
        // Gather decorator lines both ABOVE and BELOW the HTTP-method decorator
        // (order is not guaranteed — @RequirePermissions may sit below @Get).
        let j = i; const block: string[] = [];
        while (j - 1 >= 0 && lines[j - 1].trim().startsWith('@')) { j -= 1; block.push(lines[j].trim()); }
        let k = i;
        while (k + 1 < lines.length && lines[k + 1].trim().startsWith('@') && !/^\s*(?:async\s+)?\w+\s*\(/.test(lines[k + 1])) {
          k += 1; block.push(lines[k].trim());
        }
        const decorated = block.some((b) => MARKERS.some((mk) => b.includes(mk)));
        let name: string | null = null;
        for (let k = i; k < Math.min(i + 4, lines.length); k++) {
          const nm = lines[k].match(/^\s*(?:async\s+)?(\w+)\s*\(/);
          if (nm) { name = nm[1]; break; }
        }
        if (!decorated && name && name !== 'constructor' && cls) {
          (out[rel] ??= []).push({ cls, method: name, reason: 'GAP — undecorated at build; tracked by route-permission-coverage ledger until explicitly gated (Phase 4 wave)' });
        }
      }
    }
  };
  walk(SRC);
  return out;
}

const result = scan();
const count = Object.values(result).reduce((n, a) => n + a.length, 0);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`Authz inventory: ${count} undecorated handlers across ${Object.keys(result).length} controllers.`);
console.log(`Ledger written to ${path.relative(process.cwd(), OUT)}`);
