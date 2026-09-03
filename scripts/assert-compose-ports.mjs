#!/usr/bin/env node
/**
 * OPS-03 — assert the *rendered* Compose port set, not the source YAML.
 *
 * `ports: []` in an override is a no-op: Compose concatenates the multi-value
 * options, so an overlay can look hardened while the base file still publishes
 * Postgres and Redis to every interface. That is exactly what the staging
 * overlay did. The only trustworthy check is to render the merge and read the
 * result, which is what this does.
 *
 * Usage:
 *   node scripts/assert-compose-ports.mjs docker-compose.yml docker-compose.prod.yml
 *
 * Policy:
 *   - Only `caddy` may publish, and only 80 and 443.
 *   - Every other service must publish nothing, or bind to loopback only.
 * Exit 1 on violation.
 */
import { execFileSync } from 'node:child_process';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: assert-compose-ports.mjs <compose-file> [overlay...]');
  process.exit(2);
}

const args = files.flatMap((f) => ['-f', f]).concat(['config', '--format', 'json']);

let raw;
try {
  raw = execFileSync('docker', ['compose', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  console.error('docker compose config failed:\n' + (err.stderr || err.message));
  process.exit(2);
}

const config = JSON.parse(raw);
const PUBLIC_SERVICE = 'caddy';
const PUBLIC_PORTS = new Set([80, 443]);
const LOOPBACK = new Set(['127.0.0.1', '::1']);

const violations = [];
for (const [name, svc] of Object.entries(config.services ?? {})) {
  for (const p of svc.ports ?? []) {
    const hostIp = p.host_ip || '0.0.0.0';
    const published = Number(p.published);
    const where = `${name}: ${hostIp}:${published}->${p.target}`;

    if (name === PUBLIC_SERVICE) {
      if (!PUBLIC_PORTS.has(published)) {
        violations.push(`${where} — ${PUBLIC_SERVICE} may only publish 80 and 443`);
      }
      continue;
    }
    if (!LOOPBACK.has(hostIp)) {
      violations.push(`${where} — internal service published on a non-loopback interface`);
    }
  }
}

const rendered = Object.entries(config.services ?? {})
  .map(([n, s]) => `  ${n.padEnd(10)} ${JSON.stringify((s.ports ?? []).map((p) => `${p.host_ip || '0.0.0.0'}:${p.published}->${p.target}`))}`)
  .join('\n');
console.log(`Rendered ports for ${files.join(' + ')}:\n${rendered}`);

if (violations.length) {
  console.error('\nPort policy violations:\n' + violations.map((v) => `  ✗ ${v}`).join('\n'));
  process.exit(1);
}
console.log('\n✓ port policy satisfied');
