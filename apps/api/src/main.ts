import 'reflect-metadata';
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './kernel/filters/global-exception.filter';
import { TenantContextService } from './kernel/tenancy/tenant-context.service';
import { PrismaService } from './kernel/prisma/prisma.service';
import { JwtTokenService, type AccessTokenPayload } from './kernel/auth/jwt-token.service';
import { validateEnv } from './kernel/config/env';
import { requestIdMiddleware } from './kernel/observability/request-id.middleware';

/**
 * Routes allowed to authenticate from a query-string token.
 *
 * Kept to Server-Sent-Events endpoints only: the browser `EventSource` API
 * cannot attach an Authorization header, so the token has to ride in the URL.
 * Everywhere else a URL-borne credential is a needless leak into proxy access
 * logs, browser history and Referer headers.
 */
const EVENT_STREAM_PATHS = ['/pos/tables/stream', '/pos/kds/stream', '/communication/stream'];

function isEventStreamPath(path: string): boolean {
  return EVENT_STREAM_PATHS.some((p) => path.endsWith(p));
}

async function bootstrap(): Promise<void> {
  // D4-1: refuse-to-start guard. In production, missing or weak JWT secrets
  // are fatal. In dev, we warn but proceed so engineers can iterate.
  const envCheck = validateEnv();
  if (!envCheck.ok) {
    process.exit(1);
  }

  // rawBody: true lets the IdempotencyInterceptor hash the original payload
    // for Idempotency-Key replay protection.
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        rawBody: true,
        bufferLogs: true,
      });

      // Increase max header size to accommodate large JWT tokens (200+ permissions)
            // The limits MUST be applied on app.getHttpServer() AFTER listen() — the
            // Express app object returned by httpAdapter.getInstance() is a no-op for
            // maxHeaderSize (live 431 at ~18KB proved the old fallback chain never
            // reached the real http.Server).

      // Phase B2: structured JSON logging via pino.
  app.useLogger(app.get(PinoLogger));
  app.use(requestIdMiddleware);

  // Security headers via helmet. CSP disabled for the API (no HTML served);
  // crossOriginResourcePolicy loosened for /uploads served from same origin.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      frameguard: { action: 'deny' },
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  // Body size limit (defense against memory-exhaustion / slowloris). The
  // files module uses multer with its own per-file limit; this caps the rest.
  const bodyLimit = process.env.BODY_LIMIT ?? '2mb';
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });

  // Global /v1 versioning prefix.
  app.setGlobalPrefix('api/v1');

  // CORS — driven by env. Default: same-origin only.
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // LAN deployment: POS terminals browse to http://<lan-ip>:5173, an origin the
  // operator cannot know in advance (DHCP moves it), so any private-range origin
  // is accepted and a cafe LAN works out of the box.
  //
  // Three states, because this product is deployed on-prem: on by default in
  // dev, off by default in production, and explicitly opt-in-able for a real
  // on-prem LAN via CORS_ALLOW_LAN=true. Note this widens `credentials: true`
  // CORS to every host on the local network — safe on an isolated shop LAN,
  // not safe on an internet-facing box.
  const lanFlag = process.env.CORS_ALLOW_LAN;
  const allowPrivateLan =
    lanFlag === 'true' || (lanFlag !== 'false' && process.env.NODE_ENV !== 'production');
  if (allowPrivateLan && process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.warn(
      '[cors] CORS_ALLOW_LAN=true in production — every private-network origin may send credentialed requests.',
    );
  }
  const PRIVATE_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;
  const originRule: CorsOptions['origin'] = allowPrivateLan
    ? (origin, cb) => cb(null, !origin || origins.includes(origin) || PRIVATE_ORIGIN.test(origin))
    : origins.length > 0
      ? origins
      : false;

  app.enableCors({
    origin: originRule,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key', 'X-Device-Label', 'X-Pos-User', 'X-Device-Token'],
    exposedHeaders: ['X-Request-Id', 'X-Total-Count'],
    maxAge: 86_400,
  });

  // --- Tenant context middleware (ADR-004) ---------------------------------
  // Resolve org/user from the access token and run the remainder of the
  // request inside an AsyncLocalStorage context, which the Prisma extension
  // reads to auto-scope every query. Invalid/absent tokens fall through;
  // guards enforce.
  const tenant = app.get(TenantContextService);
  const jwt = app.get(JwtTokenService);
  const prisma = app.get(PrismaService);
  app.use((req: Request & { auth?: AccessTokenPayload; id?: string }, _res: Response, next: NextFunction) => {
    let token: string | undefined;
    const header = req.headers['authorization'];
    if (header?.startsWith('Bearer ')) {
      token = header.slice('Bearer '.length);
    } else if (req.query?.access_token && isEventStreamPath(req.path)) {
      // Query-string credentials leak into proxy logs, browser history and
      // Referer headers, so they are honoured ONLY on the SSE routes, where the
      // browser EventSource API genuinely cannot send an Authorization header.
      token = String(req.query.access_token);
    }
    if (token) {
      try {
        const payload = jwt.verifyAccess(token);

        // POS cashier identity (ADR — PIN attribution): when a valid `X-Pos-User`
        // token is present and belongs to the SAME organization as the bearer
        // JWT, the request is attributed to the cashier who PINned in — not the
        // back-office user whose JWT opened the terminal. This makes per-cashier
        // X/Z, audit trails, override authority and `createdBy`/`printedById`
        // correct on a shared terminal. The bearer JWT still establishes the org
        // boundary and transport auth; the POS token only narrows the identity.
        let effective = payload;
        const posHeaderRaw =
          req.headers['x-pos-user'] ?? (isEventStreamPath(req.path) ? req.query.pos_token : undefined);
        const posHeader = Array.isArray(posHeaderRaw) ? posHeaderRaw[0] : posHeaderRaw;
        if (posHeader) {
          try {
            const pos = jwt.verifyPos(String(posHeader));
            if (pos.organizationId === payload.organizationId) {
              effective = {
                sub: pos.sub,
                organizationId: payload.organizationId,
                email: pos.email,
                permissions: pos.permissions,
              };
            }
            // org mismatch → ignore the POS token, fall back to the JWT identity.
          } catch {
            // invalid/expired POS token → fall back to the JWT identity.
          }
        }

        req.auth = effective;
        return tenant.run(
          {
            organizationId: effective.organizationId,
            userId: effective.sub,
            permissions: effective.permissions,
          },
          () => next(),
        );
      } catch {
        // invalid token: continue unauthenticated, guards will reject if needed
      }
    }

    // P1 offline sync — device-token transport auth. An enrolled offline
    // device (Android app / offline web terminal) authenticates /sync/* with
    // an opaque X-Device-Token instead of a user JWT. The token is looked up
    // by sha256 (never stored plain); a hit establishes the org boundary for
    // the request. Identity (which cashier did what) travels per-op in the
    // push payload, not on the transport. Lookup uses prisma.raw because the
    // tenant context does not exist yet (same pattern as @Public endpoints).
    const deviceHeaderRaw = req.headers['x-device-token'];
    const deviceHeader = Array.isArray(deviceHeaderRaw) ? deviceHeaderRaw[0] : deviceHeaderRaw;
    if (deviceHeader) {
      const tokenHash = createHash('sha256').update(String(deviceHeader)).digest('hex');
      void prisma.raw.posDevice
        .findFirst({ where: { tokenHash, revokedAt: null } })
        .then((device: { id: string; organizationId: string; branchId: string | null } | null) => {
          if (!device) return next();
          (req as any).posDevice = device;
          return tenant.run({ organizationId: device.organizationId }, () => next());
        })
        .catch(() => next());
      return;
    }
    return next();
  });

  app.useGlobalFilters(new GlobalExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ---- OpenAPI / Swagger docs ----
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Generic ERP API')
    .setDescription('Multi-tenant modular ERP platform — generic core + verticals')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'Idempotency-Key', in: 'header' }, 'idempotency-key')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none' },
  });

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  // Bind all interfaces by default so POS terminals and Android devices on the
  // cafe LAN can reach the server. Set HOST=127.0.0.1 to restrict to loopback.
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);

  // HTTP limits must be applied on the real http.Server AFTER listen() — the
  // Express app object (httpAdapter.getInstance()) ignores maxHeaderSize, which
  // caused 431s when POS token + JWT together exceed ~16KB. Setting these after
  // listen also works because Node reads them per-connection at accept time.
  {
    const server = app.getHttpServer() as any;
    server.maxHeadersCount = 1000;
    server.headersTimeout = 60000;
    // @ts-ignore - maxHeaderSize is not in the types but works
    server.maxHeaderSize = 65536; // 64KB instead of default ~8KB
    // @ts-ignore - Increase max request line size for long URLs with tokens in query string
    server.maxRequestLineSize = 262144; // 256KB for very long URLs
  }

  const logger = app.get(PinoLogger);
  logger.log(`ERP API listening on http://localhost:${port}/api/v1 — Docs at /api/docs`);
  if (host === '0.0.0.0') {
    // Print the LAN URLs so a device can be pointed at this machine without
    // hunting through ipconfig.
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
      for (const addr of addrs ?? []) {
        if (addr.family === 'IPv4' && !addr.internal) {
          logger.log(`  LAN (${name}): http://${addr.address}:${port}/api/v1`);
        }
      }
    }
  }
}

void bootstrap();
