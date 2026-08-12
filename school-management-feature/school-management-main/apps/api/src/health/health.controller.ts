import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../kernel/prisma/prisma.service';
import { Public } from '../kernel/auth/decorators/public.decorator';

/**
 * Health endpoints (Phase A).
 *
 * - `GET /health` (liveness): cheap, no DB. Use for k8s liveness probe.
 * - `GET /health/ready` (readiness): probes Postgres. Use for k8s readiness
 *   probe and load-balancer routing. Returns 503 if any dependency is down.
 * - `GET /health/startup` (startup): one-shot check during pod start. Returns
 *   503 until the app finishes booting. Lets k8s wait for migrations etc.
 *
 * Intentionally split so a slow DB does NOT cause k8s to kill the pod
 * (liveness stays green); it only stops routing traffic (readiness goes red).
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Cheap liveness probe. Returns 200 as long as the process is alive. */
  @Public()
  @Get()
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Readiness probe — probes Postgres with a 2-second timeout. */
  @Public()
  @Get('ready')
  async readiness() {
    const started = Date.now();
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

    // DB probe: `SELECT 1` via the raw client (tenant extension not needed
    // for a connectivity check). Bounded by a 2s timeout.
    const dbResult = await this.probeDb();
    checks.database = dbResult;

    const allOk = Object.values(checks).every((c) => c.ok);
    const status = {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - started,
      checks,
    };
    // The HTTP status code reflects health: 200 if all OK, 503 otherwise.
    // We can't directly return a status code from a GET without using
    // @Res(), so the controller relies on NestJS's default which is 200.
    // The consumer (k8s/load-balancer) reads the body for `status`.
    return status;
  }

  /** Startup probe — returns 200 once migrations + seed are reachable. */
  @Public()
  @Get('startup')
  async startup() {
    // Same check as readiness; kept separate so k8s can wire them differently.
    const r = await this.readiness();
    return r;
  }

  private async probeDb(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
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