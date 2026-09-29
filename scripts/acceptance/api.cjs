/**
 * Acceptance API: the current build (apps/api/dist-acceptance) on :3013, beside
 * the usual :3003 stack, against the same dev database.
 *   Build: pnpm acceptance:build
 */
const path = require('node:path');
process.env.PORT = process.env.ACCEPTANCE_API_PORT ?? '3013';
// Test accounts sign in and out many times from this one machine.
process.env.LOGIN_THROTTLE_LIMIT = process.env.LOGIN_THROTTLE_LIMIT ?? '500';
const api = path.resolve(__dirname, '../../apps/api');
process.chdir(api);
require(path.join(api, 'dist-acceptance/main.js'));
