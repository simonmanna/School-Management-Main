/**
 * Web ⇄ API contract (E2E audit E1/E2, handover Wave 2.1).
 *
 * Two drifts took the whole enrollment UI down without a single failing test:
 *
 *   1. The web kept sending `streamId` after the DTOs dropped it. The global
 *      ValidationPipe runs with `forbidNonWhitelisted`, so every placement POST
 *      answered 400 (main.ts).
 *   2. The web kept calling `/school/enrollments*`, `/school/streams/*` and
 *      `/school/enrollment-migration/*` after those controllers were deleted, so
 *      register / place / history answered 404.
 *
 * Part A pushes the payload SHAPES the web builds through the real DTO classes
 * with the production pipe options. Part B is a route inventory: every URL the
 * web's feature clients call must resolve to a Nest route with that verb.
 */
import 'reflect-metadata';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import {
  BulkPlacementDto,
  ChangeEnrollmentStatusDto,
  CreateStudentEnrollmentDto,
  MovePlacementDto,
  PromoteEnrollmentDto,
  PromoteStudentDto,
  PromotionRolloverDto,
  RepeatGradeDto,
  UpdateClassCohortDto,
} from '../../src/modules/school/enrollment/enrollment.dto';

const ROOT = join(__dirname, '..', '..', '..', '..');
const WEB_FEATURES = join(ROOT, 'apps', 'web', 'src', 'features');
const API_SRC = join(ROOT, 'apps', 'api', 'src');

/* ─────────────────────────── Part A: payloads ─────────────────────────── */

describe('web payloads pass the production ValidationPipe', () => {
  // Same options as main.ts — the ones that turned a stray field into a 400.
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validate = (metatype: any, value: unknown) =>
    pipe.transform(value, { type: 'body', metatype } as ArgumentMetadata);

  // Shapes copied from apps/web/src/features/school/enrollment-api.ts and the
  // dialogs in pages/school/enrollment/workspace.tsx, student-360.tsx,
  // students.tsx and promotion.tsx. Keep them in step with the web.
  const placement = {
    termId: 't1',
    classCohortId: 'c1',
    sectionId: 's1',
    effectiveFrom: '2026-02-01T00:00:00.000Z',
    movementReason: 'INITIAL_PLACEMENT',
  };

  it.each([
    ['enrol / place (EnrolDialog, Student-360 "Place in class")', CreateStudentEnrollmentDto, {
      studentProfileId: 'p1', academicYearId: 'y1', enrollmentType: 'NEW', status: 'ACTIVE', placement,
    }],
    ['enrol with a class instead of a cohort, no section', CreateStudentEnrollmentDto, {
      studentProfileId: 'p1', academicYearId: 'y1', placement: { termId: 't1', classId: 'k1', sectionId: null },
    }],
    ['move (MoveDialog)', MovePlacementDto, {
      classCohortId: 'c1', sectionId: null, effectiveFrom: '2026-02-01T00:00:00.000Z',
      movementReason: 'SECTION_CHANGE', reason: 'Parent request',
    }],
    ['reinstate (ReinstateDialog)', ChangeEnrollmentStatusDto, {
      toStatus: 'ACTIVE', reason: 'Back', effectiveAt: '2026-02-01T00:00:00.000Z',
      placement: { ...placement, movementReason: 'RE_ENTRY' },
    }],
    ['repeat (RepeatDialog)', RepeatGradeDto, {
      toAcademicYearId: 'y2', toTermId: 't9', classId: 'k1', sectionId: null, reason: 'Repeat',
    }],
    ['promote one enrollment (PromoteDialog)', PromoteEnrollmentDto, {
      toAcademicYearId: 'y2', toTermId: 't9', toClassId: 'k2', sectionId: null, reason: 'End of year',
    }],
    ['bulk placement (BulkPlaceDialog)', BulkPlacementDto, {
      termId: 't1', movementReason: 'INITIAL_PLACEMENT', reason: 'Start of year', dryRun: true,
      rows: [{ enrollmentId: 'e1', classCohortId: 'c1', sectionId: 's1' }],
    }],
    ['promotion board (promotion.tsx apply)', PromoteStudentDto, {
      studentProfileId: 'p1', toTermId: 't9', toClassId: 'k2', outcome: 'repeated',
    }],
    ['rollover (promotion.tsx)', PromotionRolloverDto, { fromTermId: 't1', toTermId: 't9', dryRun: true }],
    ['cohort subdivision override (programmes.tsx)', UpdateClassCohortDto, { allowsSubdivision: null }],
  ])('%s', async (_label, metatype, body) => {
    await expect(validate(metatype, body)).resolves.toBeDefined();
  });

  it('still rejects the dropped streamId, so this spec would have caught E1', async () => {
    await expect(
      validate(MovePlacementDto, { movementReason: 'SECTION_CHANGE', reason: 'x', streamId: 'st1' }),
    ).rejects.toBeDefined();
  });

  it('rejects outcome "skipped", which the promotion board now keeps client-side', async () => {
    await expect(
      validate(PromoteStudentDto, { studentProfileId: 'p1', toTermId: 't9', outcome: 'skipped' }),
    ).rejects.toBeDefined();
  });
});

/* ──────────────────────────── Part B: routes ──────────────────────────── */

type Verb = 'get' | 'post' | 'patch' | 'put' | 'delete';
interface Route { verb: Verb; segments: string[]; where: string }

const walk = (dir: string, match: (f: string) => boolean): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : walk(full, match);
    return match(full) ? [full] : [];
  });

const split = (path: string) => path.split('/').filter(Boolean);

/** Nest routes: `@Controller('prefix')` × `@Get('sub')` etc. */
function nestRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of walk(API_SRC, (f) => f.endsWith('.controller.ts'))) {
    const src = readFileSync(file, 'utf8');
    // Each controller class: its decorator prefix applies until the next @Controller.
    const blocks = src.split(/(?=@Controller\()/);
    for (const block of blocks) {
      const ctrl = /^@Controller\(\s*(?:'([^']*)'|"([^"]*)"|\{[^}]*path:\s*'([^']*)'[^}]*\})?\s*\)/.exec(block);
      if (!ctrl) continue;
      const prefix = ctrl[1] ?? ctrl[2] ?? ctrl[3] ?? '';
      const re = /@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(block))) {
        const sub = m[2] ?? m[3] ?? m[4] ?? '';
        routes.push({
          verb: m[1].toLowerCase() as Verb,
          segments: [...split(prefix), ...split(sub)],
          where: relative(ROOT, file),
        });
      }
    }
  }
  return routes;
}

/**
 * The body of the string literal starting at `at`, with every `${…}`
 * interpolation — however nested (ternaries, inner templates) — collapsed to
 * `${}`. A leading `${NAME}` is kept by name so the caller can resolve it.
 */
function literalAt(src: string, at: number): string | null {
  const quote = src[at];
  if (quote === "'") {
    const end = src.indexOf("'", at + 1);
    return end < 0 ? null : src.slice(at + 1, end);
  }
  let out = '';
  for (let i = at + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '`') return out;
    if (ch === '$' && src[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      for (; j < src.length && depth > 0; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
      }
      const expr = src.slice(i + 2, j - 1);
      // A bare identifier or member path is one path segment; anything else
      // (a ternary choosing between paths) is marked opaque and skipped.
      out += out === '' && /^\w+$/.test(expr) ? `\${${expr}}` : /^[\w.?]+$/.test(expr) ? '${}' : '${?}';
      i = j - 1;
      continue;
    }
    out += ch;
  }
  return null;
}

/** Web calls: `api.get(`${S}/x/${id}`)`, with S resolved per file. */
function webCalls(): Route[] {
  const calls: Route[] = [];
  for (const file of walk(WEB_FEATURES, (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))) {
    const src = readFileSync(file, 'utf8');
    const consts: Record<string, string> = {};
    for (const c of src.matchAll(/const (\w+)\s*=\s*'(\/[^']*)'/g)) consts[c[1]] = c[2];
    const re = /\bapi\.(get|post|patch|put|delete)\s*(?:<[^>]*(?:<[^>]*>[^>]*)*>)?\(\s*(?=[`'])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const raw = literalAt(src, m.index + m[0].length);
      if (raw === null || raw.includes('${?}')) continue;
      // Resolve a leading ${CONST} prefix; every other ${…} is a path parameter.
      const lead = /^\$\{(\w+)\}/.exec(raw);
      if (lead && !(lead[1] in consts)) continue; // fully dynamic base: not checkable statically
      const path = (lead ? consts[lead[1]] + raw.slice(lead[0].length) : raw).split('?')[0];
      if (!path.startsWith('/')) continue;
      const line = src.slice(0, m.index).split('\n').length;
      calls.push({
        verb: m[1] as Verb,
        segments: split(path.replace(/\$\{[^}]*\}/g, '*')),
        where: `${relative(ROOT, file)}:${line}`,
      });
    }
  }
  return calls;
}

const matches = (call: Route, route: Route) =>
  call.verb === route.verb &&
  call.segments.length === route.segments.length &&
  call.segments.every((seg, i) => {
    const r = route.segments[i];
    return r.startsWith(':') || seg === '*' || seg.includes('*') || seg === r;
  });

describe('web feature clients only call routes that exist', () => {
  const routes = nestRoutes();
  const calls = webCalls();

  it('found both sides (guards against a parser that silently matches nothing)', () => {
    expect(routes.length).toBeGreaterThan(500);
    expect(calls.length).toBeGreaterThan(300);
  });

  it('every school enrollment/placement/student client URL resolves to a Nest route', () => {
    const scoped = calls.filter((c) =>
      /^(school)$/.test(c.segments[0] ?? '') &&
      /^(enrollments|student-enrollments|placements|class-cohorts|programmes|promotion|streams|enrollment-migration|students|sections)$/.test(
        c.segments[1] ?? '',
      ),
    );
    expect(scoped.length).toBeGreaterThan(20);
    const missing = scoped
      .filter((c) => !routes.some((r) => matches(c, r)))
      .map((c) => `${c.verb.toUpperCase()} /${c.segments.join('/')}  (${c.where})`);
    expect(missing).toEqual([]);
  });

  it('reports the full web→API inventory gap (ratchet: may only shrink)', () => {
    const missing = calls
      .filter((c) => !routes.some((r) => matches(c, r)))
      .map((c) => `${c.verb.toUpperCase()} /${c.segments.join('/')}  (${c.where})`);
    // eslint-disable-next-line no-console
    if (missing.length) console.log(`web→API unmatched (${missing.length}):\n` + missing.join('\n'));
    expect(missing.length).toBeLessThanOrEqual(KNOWN_UNMATCHED);
  });
});

/**
 * Unmatched web calls outside the enrollment surface when this spec landed.
 * Lower it as they are fixed; never raise it.
 */
const KNOWN_UNMATCHED = 10;
