import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { getMetadataStorage } from 'class-validator';

/**
 * Ratchet for a defect that made whole endpoints unusable: a DTO class with
 * validation metadata AND an undecorated plain field. The compiler emits the
 * field as an own property initialised to `undefined`, and the global
 * ValidationPipe (`whitelist + forbidNonWhitelisted`) then rejects EVERY request
 * with "property X should not exist" — even when the client never sent it.
 * POST /school/student-enrollments and the school-policy routes were in that state.
 *
 * Fix an offender with a validator (`@IsOptional()`, `@Allow()`), or with
 * `declare` for an internal-only field that must never come from HTTP.
 */
describe('DTO classes carry no undecorated own properties', () => {
  it('finds none', () => {
    const root = path.join(__dirname, '..', '..', 'src');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (/dto(\.types)?\.ts$/.test(e.name) && !e.name.endsWith('.spec.ts')) files.push(f);
      }
    };
    walk(root);

    const storage = getMetadataStorage() as any;
    const offenders: string[] = [];
    for (const f of files) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(f);
      for (const [name, C] of Object.entries(mod)) {
        if (typeof C !== 'function' || !/^class /.test(Function.prototype.toString.call(C))) continue;
        const metas = storage.getTargetValidationMetadatas(C, '', true, false);
        if (!metas.length) continue;
        let instance: Record<string, unknown>;
        try {
          instance = new (C as new () => Record<string, unknown>)();
        } catch {
          continue;
        }
        const decorated = new Set(metas.map((m: { propertyName: string }) => m.propertyName));
        for (const key of Object.keys(instance)) {
          if (!decorated.has(key)) offenders.push(`${path.relative(root, f)} ${name}.${key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
