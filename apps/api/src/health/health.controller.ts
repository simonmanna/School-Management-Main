import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../kernel/prisma/prisma.service';
import { Public } from '../kernel/auth/decorators/public.decorator';
import { BackupService } from '../modules/backup/backup.service';

/**
 * Health endpoints (Phase A).
 *
 * - `GET /health` (liveness, alias `/health/live`): cheap, no DB. k8s liveness.
 * - `GET /health/ready` (readiness): probes Postgres. k8s readiness and
 *   load-balancer routing. 503 when a CRITICAL dependency is down.
 * - `GET /health/startup`: one-shot check during pod start.
 *
 * Intentionally split so a slow DB does NOT cause k8s to kill the pod
 * (liveness stays green); it only stops routing traffic (readiness goes red).
 *
 * Checks are classified `critical` or `advisory`. Only critical failures set
 * 503. Backup health is advisory on purpose: a stale backup is an operational
 * problem, but draining every replica over it would turn a warning into an
 * outage. It still shows up in the body as `status: "degraded"`.
 */
type Check = { ok: boolean; latencyMs?: number; error?: string };
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(BackupService) private readonly backupService: BackupService,
  ) {}

  /**
   * Cheap liveness probe. Returns 200 as long as the process is alive.
   * `/health/live` is an alias — container and k8s probes conventionally use it,
   * and the Dockerfile HEALTHCHECK pointed there against a route that did not
   * exist, so the container never reported healthy.
   */
  @Public()
  @Get(['', 'live'])
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Readiness probe — probes Postgres with a 2-second timeout. */
  @Public()
  @Get('ready')
  async readiness(@Res({ passthrough: true }) res: Response) {
    const body = await this.collect();
    if (!body.criticalOk) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }

  /** Startup probe — returns 200 once migrations + seed are reachable. */
  @Public()
  @Get('startup')
  async startup(@Res({ passthrough: true }) res: Response) {
    // Same check as readiness; kept separate so k8s can wire them differently.
    return this.readiness(res);
  }

  private async collect() {
    const started = Date.now();

    // DB probe: `SELECT 1` via the raw client (tenant extension not needed
    // for a connectivity check). Bounded by a 2s timeout.
    const critical: Record<string, Check> = { database: await this.probeDb() };

    const advisory: Record<string, Check> = {};
    try {
      const backupHealth = await this.backupService.getHealthStatus();
      advisory.backup = {
        ok: backupHealth.status === 'healthy',
        latencyMs: 0,
        error: backupHealth.issues.join('; ') || undefined,
      };
    } catch (err) {
      advisory.backup = { ok: false, error: String(err) };
    }

    const criticalOk = Object.values(critical).every((c) => c.ok);
    const advisoryOk = Object.values(advisory).every((c) => c.ok);

    return {
      // `degraded` = serving traffic, but something needs attention.
      status: criticalOk ? (advisoryOk ? 'ok' : 'degraded') : 'unavailable',
      criticalOk,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - started,
      // Flattened for backward compatibility with existing consumers.
      checks: { ...critical, ...advisory },
      critical,
      advisory,
    };
  }

  private async probeDb(): Promise<Check> {
    const started = Date.now();
    try {
      const timeout = new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('db probe timeout')), 2000),
      );
      const query = this.prisma.raw.$queryRawUnsafe('SELECT 1');
      await Promise.race([query, timeout]);
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: String(err).slice(0, 200) };
    }
  }
}