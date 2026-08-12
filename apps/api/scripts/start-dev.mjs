// Dev launcher for the API that raises Node's HTTP header-size limit.
//
// Why: back-office users with large permission sets (e.g. admin ≈ every
// permission) carry a fat JWT, and POS routes ALSO send the cashier's
// `X-Pos-User` token — two permission-laden JWTs on one request. Combined they
// exceed Node's default 16KB header cap, so the HTTP parser rejects the request
// with `431 Request Header Fields Too Large` *before* CORS runs (which then also
// surfaces as a misleading CORS error in the browser).
//
// Setting NODE_OPTIONS here — rather than a CLI flag on `nest` — means the app
// process that `nest start --watch` spawns inherits the limit. Prod uses the
// flag directly (see the `start` / `start:prod` scripts). Override the size via
// API_MAX_HTTP_HEADER_SIZE if a deployment needs more headroom.
import { spawn } from 'node:child_process';

const size = process.env.API_MAX_HTTP_HEADER_SIZE ?? '65536';
const env = { ...process.env };
env.NODE_OPTIONS = [env.NODE_OPTIONS, `--max-http-header-size=${size}`]
  .filter(Boolean)
  .join(' ');

const child = spawn('nest', ['start', '--watch'], {
  stdio: 'inherit',
  shell: true, // resolves nest(.cmd) from node_modules/.bin cross-platform
  env,
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('[start-dev] failed to launch nest:', err.message);
  process.exit(1);
});
