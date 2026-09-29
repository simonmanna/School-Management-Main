/**
 * Acceptance web dev server on :5185, talking to the acceptance API on :3013.
 * apps/web/.env points the browser at :3003; process env wins over .env files.
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const apiPort = process.env.ACCEPTANCE_API_PORT ?? '3013';
const webPort = Number(process.env.ACCEPTANCE_WEB_PORT ?? 5185);
process.env.API_PROXY_TARGET = `http://localhost:${apiPort}`;
process.env.VITE_API_URL = `http://localhost:${apiPort}`;
process.env.WEB_DEV_PORT = String(webPort);
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps/web');
process.chdir(web);
const require = createRequire(path.join(web, 'package.json'));
const mod = await import(pathToFileURL(require.resolve('vite')).href);
const vite = mod.createServer ? mod : mod.default;
const server = await vite.createServer({ root: web, server: { port: webPort, strictPort: true } });
await server.listen();
server.printUrls();
