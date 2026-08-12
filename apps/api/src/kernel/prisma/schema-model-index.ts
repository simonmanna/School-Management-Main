import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Minimal, dependency-free reader for `schema.prisma`.
 *
 * Why not the generated Prisma DMMF? The DMMF only exists after
 * `prisma generate` has run. This index is consumed by
 * `tenancy-registration.spec.ts`, which must be able to fail the build on a
 * fresh checkout — before any client generation — because the invariant it
 * guards (a model missing from ORG_SCOPED leaks across tenants) is exactly the
 * kind of thing that slips in with a schema edit. Reading the schema text keeps
 * the check honest with zero setup.
 *
 * The parser is deliberately narrow: it understands `model X { ... }` blocks
 * and top-level field names. It does not attempt to model attributes, types or
 * relations.
 */
export interface SchemaModel {
  name: string;
  fields: Set<string>;
  /** Subset of `fields` declared optional (`Type?`). */
  optionalFields: Set<string>;
}

export const SCHEMA_PATH = join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma');

/**
 * Strip `//` and `///` comments without mangling `//` that appears inside a
 * quoted string (e.g. `@default("https://example.test")`).
 */
function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== '\\') {
      inString = !inString;
    } else if (!inString && ch === '/' && line[i + 1] === '/') {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Parse every `model` block into its name and the set of its field names. */
export function parseSchemaModels(schemaText: string): SchemaModel[] {
  const models: SchemaModel[] = [];
  let current: SchemaModel | null = null;

  for (const rawLine of schemaText.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (line === '') continue;

    if (current === null) {
      const open = /^model\s+(\w+)\s*\{/.exec(line);
      if (open) {
        current = { name: open[1], fields: new Set<string>(), optionalFields: new Set<string>() };
      }
      continue;
    }

    if (line === '}') {
      models.push(current);
      current = null;
      continue;
    }

    // Block-level attributes (`@@index`, `@@unique`, `@@map`) are not fields.
    if (line.startsWith('@@')) continue;

    const field = /^(\w+)\s+([\w[\]]+\??)/.exec(line);
    if (field) {
      current.fields.add(field[1]);
      if (field[2].endsWith('?')) current.optionalFields.add(field[1]);
    }
  }

  return models;
}

export function loadSchemaModels(path: string = SCHEMA_PATH): SchemaModel[] {
  return parseSchemaModels(readFileSync(path, 'utf8'));
}
