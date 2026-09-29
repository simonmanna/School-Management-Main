/**
 * Acceptance API: the current build (apps/api/dist-acceptance) on :3013, beside
 * the usual :3003 stack, against the same dev database.
 *   Build: pnpm acceptance:build
 */
const path = require('node:path');
process.env.PORT = process.env.ACCEPTANCE_API_PORT ?? '3013';
const api = path.resolve(__dirname, '../../apps/api');
process.chdir(api);
require(path.join(api, 'dist-acceptance/main.js'));
