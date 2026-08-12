import {
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface IdempotencyResult {
  /** True when we returned a cached response and did not run the handler. */
  replayed: boolean;
  statusCode: number;
  body: any;
}

/**
 * Idempotency-Key handling (D1-2).
 *
 * The caller (decorator + interceptor) provides the raw Express request and a
 * callback that runs the actual handler. We:
 *   1. Hash (method + path + rawBody) and look for a matching `IdempotencyRecord`.
 *   2. If found AND completed AND hash matches → return the cached response
 *      (`replayed: true`). The handler does not run.
 *   3. If found AND completed AND hash mismatches → 409 (same key, different body).
 *   4. If found AND pending → 409 (another request is still in flight).
 *   5. If not found → INSERT a `pending` row first (using ON CONFLICT semantics),
 *      run the handler, then UPDATE the row with the response and
 *      `status='completed'`.
 *
 * The pending INSERT acts as a distributed lock per (organizationId, key): only
 * one concurrent caller can hold the row, the rest see the conflict and 409.
 * On handler failure we DELETE the pending row so the caller can retry with
 * the same key.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger('IdempotencyService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Run `runHandler` under the protection of an idempotency key. The handler
   * MUST execute its business write inside a Prisma transaction (pass `tx` if
   * needed) so that the cached response reflects what actually committed.
   */
  async execute<T>(params: {
    request: Request;
    rawBody: string;
    runHandler: () => Promise<{ statusCode: number; body: T }>;
  }): Promise<IdempotencyResult> {
    const key = this.readKey(params.request);
    if (!key) {
      // No key header → not protected; just run the handler.
      const { statusCode, body } = await params.runHandler();
      return { replayed: false, statusCode, body };
    }

    const organizationId = this.tenant.organizationId;
    const method = params.request.method;
    const path = params.request.originalUrl ?? params.request.url;
    const requestHash = this.hashRequest(method, path, params.rawBody);

    // 1) Look for an existing record.
    const existing = await this.prisma.client.idempotencyRecord.findUnique({
      where: { organizationId_key: { organizationId, key } },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          `Idempotency-Key '${key}' was previously used with a different request body`,
        );
      }
      if (existing.status === 'pending') {
        throw new ConflictException(
          `Idempotency-Key '${key}' is still being processed; retry shortly`,
        );
      }
      // Replay.
      return { replayed: true, statusCode: existing.statusCode, body: existing.responseJson };
    }

    // 2) Insert a pending row first to act as a lock. The unique constraint on
    //    (organizationId, key) ensures only one writer wins.
    try {
      await this.prisma.client.idempotencyRecord.create({
        data: {
          organizationId,
          key,
          requestHash,
          method,
          path,
          statusCode: 0,
          responseJson: {},
          status: 'pending',
        },
      });
    } catch (err) {
      // Another concurrent request beat us to it. Read its state and respond.
      const winner = await this.prisma.client.idempotencyRecord.findUnique({
        where: { organizationId_key: { organizationId, key } },
      });
      if (winner && winner.status === 'completed') {
        return { replayed: true, statusCode: winner.statusCode, body: winner.responseJson };
      }
      throw new ConflictException(
        `Idempotency-Key '${key}' is being processed concurrently; retry shortly`,
      );
    }

    // 3) Run the handler.
    try {
      const { statusCode, body } = await params.runHandler();
      await this.prisma.client.idempotencyRecord.update({
        where: { organizationId_key: { organizationId, key } },
        data: {
          statusCode,
          responseJson: body as any,
          status: 'completed',
          completedAt: new Date(),
        },
      });
      return { replayed: false, statusCode, body };
    } catch (err) {
      // Handler failed — clear the pending lock so the caller can retry with
      // the same key. We log a warning so operators see retry storms.
      await this.prisma.client.idempotencyRecord
        .delete({ where: { organizationId_key: { organizationId, key } } })
        .catch((delErr: unknown) => this.logger.warn(`Failed to clear pending idempotency row: ${String(delErr)}`));
      throw err;
    }
  }

  private readKey(req: Request): string | undefined {
    const raw = req.headers['idempotency-key'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) return undefined;
    const trimmed = String(value).trim();
    if (!trimmed) return undefined;
    if (trimmed.length > 200) {
      throw new ConflictException('Idempotency-Key header is too long (max 200 chars)');
    }
    return trimmed;
  }

  private hashRequest(method: string, path: string, rawBody: string): string {
    return createHash('sha256').update(`${method}\n${path}\n${rawBody}`).digest('hex');
  }
}