import 'reflect-metadata';
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { TenantContextService } from './kernel/tenancy/tenant-context.service';
import { JwtTokenService, type AccessTokenPayload } from './kernel/auth/jwt-token.service';
import { validateEnv } from './kernel/config/env';
import { requestIdMiddleware } from './kernel/observability/request-id.middleware';

async function bootstrap(): Promise<void> {
  // D4-1: refuse-to-start guard. In production, missing or weak JWT secrets
  // are fatal. In dev, we warn but proceed so engineers can iterate.
  const envCheck = validateEnv();
  if (!envCheck.ok) {
    process.exit(1);
  }

  // rawBody: true lets the IdempotencyInterceptor hash the original payload
  // for Idempotency-Key replay protection.
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });

  // Phase B2: structured JSON logging via pino. Every log line carries
  // `context`, `requestId`, and `orgId` (when in a tenant context).
  app.useLogger(app.get(PinoLogger));
  app.use(requestIdMiddleware);

  app.setGlobalPrefix('api');

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  // --- Tenant context middleware (ADR-004) ---------------------------------
  // Resolve org/user from the access token and run the remainder of the request
  // inside an AsyncLocalStorage context, which the Prisma extension reads to
  // auto-scope every query. Invalid/absent tokens fall through; guards enforce.
  const tenant = app.get(TenantContextService);
  const jwt = app.get(JwtTokenService);
  app.use((req: Request & { auth?: AccessTokenPayload; id?: string }, _res: Response, next: NextFunction) => {
    const header = req.headers['authorization'];
    if (header?.startsWith('Bearer ')) {
      try {
        const payload = jwt.verifyAccess(header.slice('Bearer '.length));
        req.auth = payload;
        return tenant.run(
          {
            organizationId: payload.organizationId,
            userId: payload.sub,
            permissions: payload.permissions,
          },
          () => next(),
        );
      } catch {
        // invalid token: continue unauthenticated, guards will reject if needed
      }
    }
    return next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  app.get(PinoLogger).log(`ERP API listening on http://localhost:${port}/api`);
}

void bootstrap();
