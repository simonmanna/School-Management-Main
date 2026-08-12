import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { Logger } from 'nestjs-pino';

/**
 * Phase B2: request-id middleware. Adds `X-Request-Id` to every request
 * (generating a UUID if missing), stores it on `req.id`, and pushes it into
 * the pino logger bindings so every log line carries the correlation id.
 *
 * When something goes wrong in production, the request id is the only way
 * to find the relevant logs across services.
 */
export function requestIdMiddleware(req: Request & { id?: string }, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const id = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}