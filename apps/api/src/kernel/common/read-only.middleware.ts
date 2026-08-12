import { ForbiddenException, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * READ_ONLY_MODE guard (P4).
 *
 * The cloud instance runs the same API image against a Postgres **logical
 * replication subscriber**. A subscriber is not a writable database: any write
 * would either fail on conflict or, worse, silently diverge from the cafe LAN
 * (the real source of truth) until the next replicated row overwrote it.
 *
 * So the cloud deployment sets READ_ONLY_MODE=true and this middleware refuses
 * every mutating verb up front, with a message that tells the operator where
 * to actually write. Auth endpoints stay open — reading reports still needs a
 * login, and logging in is a POST.
 */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Login/refresh/logout are POSTs that must work on a read-only reports node.
 *  They write only to RefreshToken, which is node-local session state. */
const ALLOWED_PATHS = [/^\/api\/v1\/auth\/(login|refresh|logout|mfa)/];

@Injectable()
export class ReadOnlyMiddleware implements NestMiddleware {
  private readonly logger = new Logger('ReadOnlyMode');
  private readonly enabled = process.env.READ_ONLY_MODE === 'true';

  constructor() {
    if (this.enabled) {
      this.logger.warn('READ_ONLY_MODE is ON — this node rejects all writes (reports/backup replica)');
    }
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    if (!this.enabled || !MUTATING.has(req.method)) return next();

    const path = req.originalUrl ?? req.url;
    if (ALLOWED_PATHS.some((re) => re.test(path))) return next();

    throw new ForbiddenException(
      'This server is a read-only reporting replica. Sales and edits must be made on the cafe POS server.',
    );
  }
}
