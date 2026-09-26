/**
 * HTTP contract specs — the seam every other test skips.
 *
 * Every existing spec calls services directly, so nothing in the suite ever ran
 * a request through the global `ValidationPipe`. That is precisely where P0-1
 * lived: `EnrollStudentDto`, `RegisterStudentDto` and `EndEnrollmentDto` had no
 * class-validator decorators, and the pipe is configured
 * `whitelist + forbidNonWhitelisted` with `forbidUnknownValues` left at its
 * default of true. class-validator short-circuits a class with no validation
 * metadata (`if (forbidUnknownValues && !targetMetadatas.length)`) and returns
 * `an unknown value was passed to the validate function` — so all five
 * placement routes answered 400 to every request, including the ones the
 * placement UI had just been built to send.
 *
 * These specs boot a real HTTP app around the controller with the real pipe and
 * mocked services, so they need no database and no auth. The point is not to
 * test business logic — other specs do that — but to prove the request actually
 * reaches it.
 */
import { DataScopeService } from '../../src/kernel/auth/data-scope.service';
import { PrismaService } from '../../src/kernel/prisma/prisma.service';
import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common';

import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import {
  PlacementController,
  PromotionRunController,
  StudentEnrollmentController,
} from '../../src/modules/school/enrollment/enrollment.controller';
import { StudentEnrollmentService } from '../../src/modules/school/enrollment/student-enrollment.service';
import { PlacementService } from '../../src/modules/school/enrollment/placement.service';
import { PromotionRunService } from '../../src/modules/school/enrollment/promotion-run.service';
import { IdempotencyService } from '../../src/kernel/idempotency/idempotency.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

/** Mirrors `main.ts` exactly — if that changes, this must change with it. */
const productionPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

// Compiling a Nest module graph and walking every source file both take longer
// than Jest's 5s default when the rest of the suite is running in parallel.
// (The DB-backed specs get this from `_setup`; this one needs no database, so
// it sets its own rather than importing that.)
jest.setTimeout(120_000);

class AllowAll {
  canActivate(_ctx: ExecutionContext) {
    return true;
  }
}

describe('http contract: enrollment & placement routes survive the global ValidationPipe', () => {
  let app: INestApplication;
  const ok = (name: string) => jest.fn(async (...args: unknown[]) => ({ ok: true, name, args }));
  const enrollments = {
    create: ok('create'),
    lateAdmission: ok('lateAdmission'),
    changeStatus: ok('changeStatus'),
    withdraw: ok('withdraw'),
    transferOut: ok('transferOut'),
    suspend: ok('suspend'),
    complete: ok('complete'),
    repeat: ok('repeat'),
    promote: ok('promote'),
    list: ok('list'),
    get: ok('get'),
    forStudent: ok('forStudent'),
  };
  const placements = { move: ok('move'), preview: ok('preview'), bulkPlace: ok('bulkPlace'), termRollover: ok('termRollover'), roster: ok('roster'), history: ok('history'), placementAt: ok('placementAt') };
  const promotion = { promote: ok('promote'), rollover: ok('rollover') };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StudentEnrollmentController, PlacementController, PromotionRunController],
      providers: [
        { provide: StudentEnrollmentService, useValue: enrollments },
        { provide: PlacementService, useValue: placements },
        { provide: PromotionRunService, useValue: promotion },
        // No Idempotency-Key header in these requests: the interceptor just runs the handler.
        { provide: IdempotencyService, useValue: { execute: async (p: any) => ({ replayed: false, ...(await p.runHandler()) }) } },
        { provide: TenantContextService, useValue: { organizationId: 'org-test', userId: 'user-test' } },
        // Re-audit #3 P1-15: enrollment/placement reads check the caller's data scope.
        { provide: DataScopeService, useValue: { assertMayReadStudent: async () => undefined, assertMayReadClass: async () => undefined } },
        { provide: PrismaService, useValue: { client: { studentEnrollment: { findFirst: async () => null }, classCohort: { findFirst: async () => null } } } },
        { provide: APP_GUARD, useClass: AllowAll },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(productionPipe());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('POST /school/student-enrollments accepts a well-formed enrollment with placement', async () => {
    const res = await request(app.getHttpServer()).post('/school/student-enrollments').send({
      studentProfileId: 'sp-1',
      academicYearId: 'y-1',
      placement: { termId: 'term-1', classId: 'class-1', sectionId: 'sec-1' },
    });
    expect(res.status).toBe(201);
    expect(enrollments.create).toHaveBeenCalledTimes(1);
  });

  it('refuses an enrollment created straight into a terminal status', async () => {
    const res = await request(app.getHttpServer()).post('/school/student-enrollments').send({
      studentProfileId: 'sp-1',
      academicYearId: 'y-1',
      status: 'WITHDRAWN',
    });
    expect(res.status).toBe(400);
    expect(enrollments.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown property rather than silently dropping it', async () => {
    const res = await request(app.getHttpServer()).post('/school/student-enrollments').send({
      studentProfileId: 'sp-1',
      academicYearId: 'y-1',
      currentClassId: 'class-9',
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toMatch(/currentClassId/);
    expect(enrollments.create).not.toHaveBeenCalled();
  });

  it('rejects admissionApplicationId from an HTTP body (set internally by admissions only)', async () => {
    const res = await request(app.getHttpServer()).post('/school/student-enrollments').send({
      studentProfileId: 'sp-1',
      academicYearId: 'y-1',
      admissionApplicationId: 'app-1',
    });
    expect(res.status).toBe(400);
  });

  it.each(['withdraw', 'transfer-out', 'complete'])('POST /school/student-enrollments/:id/%s needs a reason', async (action) => {
    const bad = await request(app.getHttpServer()).post(`/school/student-enrollments/e-1/${action}`).send({});
    expect(bad.status).toBe(400);
    const good = await request(app.getHttpServer()).post(`/school/student-enrollments/e-1/${action}`).send({ reason: 'Family moved' });
    expect(good.status).toBe(201);
  });

  it('POST /:id/suspend accepts an end date', async () => {
    const res = await request(app.getHttpServer())
      .post('/school/student-enrollments/e-1/suspend')
      .send({ reason: 'Conduct', suspendedUntil: '2026-03-01' });
    expect(res.status).toBe(201);
    expect(enrollments.suspend).toHaveBeenCalledWith('e-1', expect.objectContaining({ suspendedUntil: '2026-03-01' }));
  });

  it('POST /school/placements/:id/move reaches the service', async () => {
    const res = await request(app.getHttpServer())
      .post('/school/placements/e-1/move')
      .send({ sectionId: 'sec-2', movementReason: 'SECTION_CHANGE', reason: 'Balancing streams' });
    expect(res.status).toBe(201);
    expect(placements.move).toHaveBeenCalledTimes(1);
  });

  it('POST /school/promotion/rollover and /promote reach the promotion service', async () => {
    const r1 = await request(app.getHttpServer())
      .post('/school/promotion/rollover')
      .send({ fromTermId: 't-1', toTermId: 't-2', dryRun: true });
    expect(r1.status).toBe(201);
    const r2 = await request(app.getHttpServer())
      .post('/school/promotion/promote')
      .send({ studentProfileId: 'sp-1', toTermId: 't-2', outcome: 'repeated' });
    expect(r2.status).toBe(201);
    const bad = await request(app.getHttpServer())
      .post('/school/promotion/promote')
      .send({ studentProfileId: 'sp-1', toTermId: 't-2', outcome: 'skipped' });
    expect(bad.status).toBe(400);
  });
});

/**
 * The systemic version of the same check: no `@Body()` DTO class anywhere may
 * ship without validation metadata, or its route 400s on every request.
 *
 * Deliberately a static scan rather than a route-by-route test — there are ~470
 * body DTOs and the failure mode is uniform.
 */
describe('http contract: every @Body() DTO carries validation metadata', () => {
  it('finds no undecorated body DTO in the codebase', () => {
    const srcRoot = path.join(__dirname, '..', '..', 'src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.ts')) files.push(full);
      }
    };
    walk(srcRoot);

    const bodyTypes = new Set<string>();
    for (const f of files.filter((x) => x.endsWith('.controller.ts'))) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/@Body\(\s*\)\s*\w+\s*:\s*([A-Z]\w+)/g)) bodyTypes.add(m[1]);
    }

    const decorator =
      /@(IsString|IsInt|IsNumber|IsBoolean|IsOptional|IsArray|IsIn|IsObject|IsUUID|IsEnum|IsDate|IsDateString|ValidateNested|IsNotEmpty|IsEmail|IsPositive|Min|Max|Type)\b/;

    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/export class (\w+)\s*(?:extends[^{]+)?\{([\s\S]*?)\n\}/g)) {
        const name = m[1];
        const body = m[2];
        if (bodyTypes.has(name) && !decorator.test(body)) {
          offenders.push(name + ' (' + path.relative(srcRoot, f) + ')');
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
