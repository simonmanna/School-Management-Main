/**
 * DMS module (Phase 1 — registry; Phase 2 — lifecycle engine; Phase 3 —
 * timeline). Always-on core (no feature flag): writers across verticals depend
 * on the type resolver; the seeder maintains the global registry on every
 * boot. @Global so any vertical module (invoicing, recurring, rental, school)
 * can inject DmsTypeResolver / DocumentEngineService without import edges.
 */
import { Global, Module } from '@nestjs/common';
import { BrowserPoolService } from './browser-pool.service';
import { DocumentActionsController } from './document-actions.controller';
import { DocumentAttachmentsService } from './document-attachments.service';
import { DmsWorkflowSubscriber } from './dms-workflow.subscriber';
import { DocumentEngineService } from './document-engine.service';
import { DocumentLifecyclesService } from './document-lifecycles.service';
import { DocumentPermissionsService } from './document-permissions.service';
import { DocumentPrintService } from './document-print.service';
import { DocumentRelationsService } from './document-relations.service';
import { DocumentRenderService } from './document-render.service';
import { DocumentSourcesService } from './document-sources.service';
import { DocumentTypeDefsService } from './document-type-defs.service';
import { DocumentTypesController } from './document-types.controller';
import { DocumentsController } from './documents.controller';
import { DmsSeeder } from './dms.seeder';
import { DmsTypeResolver } from './dms-type-resolver.service';

@Global()
@Module({
  controllers: [DocumentTypesController, DocumentActionsController, DocumentsController],
  providers: [
    DmsSeeder,
    DmsTypeResolver,
    DocumentTypeDefsService,
    DocumentLifecyclesService,
    DocumentPermissionsService,
    DocumentEngineService,
    // Phase 4 — rendering + printing
    BrowserPoolService,
    DocumentRenderService,
    DocumentPrintService,
    // Phase 5 — relations, sources, attachments
    DocumentRelationsService,
    DocumentSourcesService,
    DocumentAttachmentsService,
    // Phase 8 — workflow subscriptions (DMS events → POS hooks)
    DmsWorkflowSubscriber,
  ],
  exports: [
    DmsTypeResolver,
    DocumentTypeDefsService,
    DocumentLifecyclesService,
    DocumentPermissionsService,
    DocumentEngineService,
    DocumentRenderService,
    DocumentRelationsService,
    DocumentSourcesService,
  ],
})
export class DocumentsModule {}