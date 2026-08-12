/**
 * Read-only DMS registry endpoints (Phase 1.4). Consumed by the Document
 * Center UI (Phase 7) and e2e smoke tests. Write endpoints arrive with the
 * registry admin UI; lifecycle actions arrive with the Phase 2 engine.
 */
import { Controller, Get, Param, Post, Put, Delete, Body, Patch } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { CurrentOrg } from './current-org.decorator';
import { DocumentTypeDefsService } from './document-type-defs.service';
import { DocumentLifecyclesService } from './document-lifecycles.service';

export interface TypeDefCreateBody {
  code: string;
  name: string;
  category?: string;
  lifecycleId?: string | null;
  config?: Record<string, unknown>;
}

export interface TypeDefUpdateBody {
  name?: string;
  description?: string;
  category?: string;
  lifecycleId?: string | null;
  isActive?: boolean;
  [key: string]: unknown;
}

@Controller('documents')
export class DocumentTypesController {
  constructor(
    private readonly typeDefs: DocumentTypeDefsService,
    private readonly lifecycles: DocumentLifecyclesService,
  ) {}

  /** Registry effective for the requesting org (ADR O2). */
  @Get('types')
  @RequirePermissions(PERMISSIONS.document.read)
  types(@CurrentOrg() orgId: string) {
    return this.typeDefs.listEffective(orgId);
  }

  @Get('types/:code')
  @RequirePermissions(PERMISSIONS.document.read)
  type(@Param('code') code: string) {
    return this.typeDefs.getByCode(code);
  }

  @Get('types/categories')
  @RequirePermissions(PERMISSIONS.document.read)
  categories() {
    return this.typeDefs.listCategories();
  }

  @Get('lifecycles')
  @RequirePermissions(PERMISSIONS.document.read)
  listLifecycles() {
    return this.lifecycles.list();
  }

  @Get('lifecycles/:code')
  @RequirePermissions(PERMISSIONS.document.read)
  lifecycle(@Param('code') code: string) {
    return this.lifecycles.getByCode(code);
  }

  // --- Phase 7: registry write endpoints ----------------------------------

  @Post('types')
  @RequirePermissions(PERMISSIONS.documentType.create)
  create(@CurrentOrg() orgId: string, @Body() body: TypeDefCreateBody) {
    return this.typeDefs.create({ orgId, code: body.code, name: body.name, category: body.category, lifecycleId: body.lifecycleId, config: body.config });
  }

  @Patch('types/:code')
  @RequirePermissions(PERMISSIONS.documentType.update)
  update(@CurrentOrg() orgId: string, @Param('code') code: string, @Body() body: TypeDefUpdateBody) {
    return this.typeDefs.updateByCode(orgId, code, body);
  }

  @Delete('types/:code')
  @RequirePermissions(PERMISSIONS.documentType.delete)
  remove(@CurrentOrg() orgId: string, @Param('code') code: string) {
    return this.typeDefs.removeByCode(orgId, code);
  }
}