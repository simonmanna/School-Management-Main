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
import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common';

import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import { EnrollmentController } from '../../src/modules/school/people/enrollment.controller';
import { EnrollmentService } from '../../src/modules/school/people/enrollment.service';
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

describe('http contract: placement routes survive the global ValidationPipe', () => {
  let app: INestApplication;
  const service = {
    register: jest.fn(async (dto: unknown) => ({ ok: true, dto })),
    enroll: jest.fn(async (dto: unknown) => ({ ok: true, dto })),
    transferOut: jest.fn(async (_id: string, dto: unknown) => ({ ok: true, dto })),
    withdraw: jest.fn(async (_id: string, dto: unknown) => ({ ok: true, dto })),
    reEnroll: jest.fn(async (_id: string, dto: unknown) => ({ ok: true, dto })),
    list: jest.fn(async () => []),
    history: jest.fn(async () => []),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EnrollmentController],
      providers: [
        { provide: EnrollmentService, useValue: service },
        { provide: TenantContextService, useValue: { organizationId: 'org-test', userId: 'user-test' } },
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

  // ── the regression that started this ──────────────────────────────────────

  it('POST /school/enrollments accepts a well-formed placement and reaches the service', async () => {
    const body = {
      studentProfileId: 'sp-1',
      classId: 'class-1',
      sectionId: 'sec-1',
      termId: 'term-1',
      rollNumber: '12',
    };
    const res = await request(app.getHttpServer()).post('/school/enrollments').send(body);

    expect(res.status).toBe(201);
    expect(service.enroll).toHaveBeenCalledTimes(1);
    expect(service.enroll.mock.calls[0][0]).toMatchObject(body);
  });

  it('POST /school/enrollments/register accepts the quick register-and-place payload', async () => {
    const body = {
      name: 'Sarah Namukasa',
      classId: 'class-1',
      termId: 'term-1',
      rollNumber: '7',
      streamId: 'stream-1',
      gender: 'female',
      residenceType: 'day',
      guardianName: 'Grace Namukasa',
      guardianPhone: '+256700000000',
    };
    const res = await request(app.getHttpServer()).post('/school/enrollments/register').send(body);

    expect(res.status).toBe(201);
    expect(service.register).toHaveBeenCalledTimes(1);
    expect(service.register.mock.calls[0][0]).toMatchObject({ name: 'Sarah Namukasa', classId: 'class-1' });
  });

  it.each(['transfer-out', 'withdraw', 're-enroll'])(
    'POST /school/enrollments/:id/%s accepts a reason',
    async (action) => {
      const res = await request(app.getHttpServer())
        .post('/school/enrollments/enr-1/' + action)
        .send({ reason: 'Family relocated' });
      expect(res.status).toBe(201);
    },
  );

  // ── and the validation it was supposed to be doing all along ──────────────

  it('rejects a placement missing its required fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/school/enrollments')
      .send({ studentProfileId: 'sp-1' });

    expect(res.status).toBe(400);
    expect(service.enroll).not.toHaveBeenCalled();
  });

  it('rejects an unknown property rather than silently dropping it', async () => {
    const res = await request(app.getHttpServer()).post('/school/enrollments').send({
      studentProfileId: 'sp-1',
      classId: 'class-1',
      termId: 'term-1',
      rollNumber: '12',
      currentClassId: 'class-9',
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toMatch(/currentClassId/);
    expect(service.enroll).not.toHaveBeenCalled();
  });

  it('rejects a gender outside the allowed set', async () => {
    const res = await request(app.getHttpServer()).post('/school/enrollments/register').send({
      name: 'Test Pupil',
      classId: 'class-1',
      termId: 'term-1',
      rollNumber: '1',
      gender: 'not-a-gender',
    });

    expect(res.status).toBe(400);
    expect(service.register).not.toHaveBeenCalled();
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
