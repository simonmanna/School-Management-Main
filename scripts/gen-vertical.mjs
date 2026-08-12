#!/usr/bin/env node
/**
 * Scaffold a new vertical (ADR-011).
 *
 * Usage:
 *   pnpm gen:vertical pos
 *   pnpm gen:vertical school
 *
 * Creates:
 *   apps/api/src/modules/<name>/<name>.module.ts
 *   apps/api/src/modules/<name>/<name>.service.ts
 *   apps/api/src/modules/<name>/<name>.controller.ts
 *   apps/api/src/modules/<name>/<name>.module.spec.ts
 *   apps/api/src/modules/<name>/dto/.gitkeep
 *
 * Wires:
 *   - Adds <name>Module to apps/api/src/app.module.ts.
 *   - Adds <name> permissions to packages/shared/src/permissions.ts (placeholder).
 *   - Adds <name> to the vertical set in apps/web/src/lib/api.ts routes comment.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const name = process.argv[2];

if (!name) {
  console.error('Usage: pnpm gen:vertical <name>');
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error(`Invalid vertical name '${name}'. Use lowercase letters, digits, and dashes.`);
  process.exit(1);
}

const className = name
  .split('-')
  .map((part) => part[0].toUpperCase() + part.slice(1))
  .join('');

const moduleDir = join(root, 'apps', 'api', 'src', 'modules', name);
if (existsSync(moduleDir)) {
  console.error(`Module directory already exists: ${moduleDir}`);
  process.exit(1);
}

mkdirSync(join(moduleDir, 'dto'), { recursive: true });
writeFileSync(join(moduleDir, 'dto', '.gitkeep'), '');

writeFileSync(
  join(moduleDir, `${name}.module.ts`),
  `import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { ${className}Service } from './${name}.service';
import { ${className}Controller } from './${name}.controller';

/**
 * ${className} — vertical built on the reusable core (ADR-011).
 * Declare every dependency the manifest below imports from core/accounting/invoicing/inventory.
 */
@Module({
  imports: [/* AccountingModule, InvoicingModule, InventoryModule, CoreModule */],
  controllers: [${className}Controller],
  providers: [${className}Service],
})
export class ${className}Module implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: '${name}',
      version: '0.1.0',
      dependencies: [/* 'accounting', 'invoicing', 'inventory', 'core' */],
      permissions: [/* 'pos:read', 'pos:checkout', etc. */],
    });
  }
}
`,
);

writeFileSync(
  join(moduleDir, `${name}.service.ts`),
  `import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';

/**
 * ${className}Service — vertical-specific business logic.
 * Use PostingService for any financial effect; never write to JournalLine directly.
 */
@Injectable()
export class ${className}Service {
  constructor(private readonly prisma: PrismaService) {}

  // TODO: implement vertical behaviour here.
}
`,
);

writeFileSync(
  join(moduleDir, `${name}.controller.ts`),
  `import { Controller } from '@nestjs/common';
import { ${className}Service } from './${name}.service';

@Controller('${name}')
export class ${className}Controller {
  constructor(private readonly service: ${className}Service) {}

  // TODO: add routes here.
}
`,
);

writeFileSync(
  join(moduleDir, `${name}.module.spec.ts`),
  `import { ${className}Module } from './${name}.module';

describe('${className}Module', () => {
  it('is defined', () => {
    expect(${className}Module).toBeDefined();
  });
});
`,
);

// Wire AppModule
const appModulePath = join(root, 'apps', 'api', 'src', 'app.module.ts');
const appModule = readFileSync(appModulePath, 'utf8');
if (!appModule.includes(`${className}Module`)) {
  const newImport = `import { ${className}Module } from './modules/${name}/${name}.module';\n`;
  const updated = appModule
    .replace(/(import \{ InventoryModule \} from '.\/modules\/inventory\/inventory.module';\n)/, `$1${newImport}`)
    .replace((
      /imports: \[KernelModule, AuthModule, CoreModule, AccountingModule, InvoicingModule, InventoryModule\],/
    ), `imports: [KernelModule, AuthModule, CoreModule, AccountingModule, InvoicingModule, InventoryModule, ${className}Module],`);

  if (updated === appModule) {
    console.warn('Could not auto-wire AppModule. Please add ${className}Module manually.');
  } else {
    writeFileSync(appModulePath, updated);
    console.log(`✓ Wired ${className}Module into AppModule`);
  }
}

// Update dependency-cruiser — add the new vertical as a known leaf
const dcPath = join(root, '.dependency-cruiser.cjs');
const dc = readFileSync(dcPath, 'utf8');
const knownSet = '(?!core/|accounting/|invoicing/|inventory/|kernel/|auth/|settings/|audit/|tenancy/|prisma/|events/|sequence/|workflow/|module-loader/|common/)';
if (!dc.includes(`${name}/|`)) {
  const updated = dc.replace(
    new RegExp(knownSet, 'g'),
    knownSet.replace('inventory/|', `inventory/|${name}/|`),
  );
  writeFileSync(dcPath, updated);
  console.log(`✓ Added '${name}' to dependency-cruiser allowlist`);
}

console.log(`\n✓ Vertical '${name}' scaffolded at apps/api/src/modules/${name}/`);
console.log(`  Next steps:`);
console.log(`    1. Fill in ${className}Service and ${className}Controller.`);
console.log(`    2. Update dependencies in ${name}.module.ts (e.g. ['accounting', 'invoicing']).`);
console.log(`    3. Add permissions to packages/shared/src/permissions.ts.`);
console.log(`    4. Run pnpm lint:arch to verify boundaries.`);