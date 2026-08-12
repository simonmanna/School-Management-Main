/**
 * DMS — Phase 2.6 CRUD surface + Phase 3 timeline + Phase 4/5 surface.
 *
 *   GET    /api/v1/documents               list (type/status/branch/q filters,
 *                                          permission-prefiltered to readable types)
 *   GET    /api/v1/documents/:id           detail incl. lines + registry policies
 *   PATCH  /api/v1/documents/:id           guarded field update with optimistic lock
 *   GET    /api/v1/documents/:id/timeline  actions + prints + snapshots + relations
 *                                          + sources + versions + attachments
 *   GET    /api/v1/documents/:id/preview   live render (no print log)
 *   POST   /api/v1/documents/:id/print     render + log (Idempotency-Key required)
 *   GET    /api/v1/documents/templates     active templates (admin: ?type&format)
 *   POST   /api/v1/documents/templates     create a new template version (admin)
 *   POST   /api/v1/documents/templates/:id/activate  one active per templateKey+format
 *   POST   /api/v1/documents/:id/relations create relation (semantics §3.3)
 *   GET    /api/v1/documents/:id/relations both directions
 *   GET    /api/v1/documents/:id/relations/chain?type=  BFS chain (cycle-guarded)
 *   DELETE /api/v1/documents/:id/relations/:rid
 *   POST   /api/v1/documents/:id/sources   link a source record (validator registry)
 *   GET    /api/v1/documents/:id/sources
 *   DELETE /api/v1/documents/:id/sources/:sid
 *   POST   /api/v1/documents/:id/attachments   multipart upload → File vault (G3)
 *   GET    /api/v1/documents/:id/attachments
 *   DELETE /api/v1/documents/:id/attachments/:aid
 *
 * Permission checks are runtime (per document type) because no static
 * @RequirePermissions can express doc:<type>:<action>.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../../kernel/auth/jwt-token.service';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { CurrentUser } from '../../kernel/auth/decorators/current-user.decorator';
import { DocumentPermissionsService, toPermissionSubject } from './document-permissions.service';
import { DocumentPrintService } from './document-print.service';
import { DocumentRenderService } from './document-render.service';
import { DocumentRelationsService } from './document-relations.service';
import { DocumentSourcesService } from './document-sources.service';
import { DocumentAttachmentsService } from './document-attachments.service';

/** Fields a consumer may patch through the generic endpoint. */
const PATCHABLE_FIELDS = [
  'reference',
  'notes',
  'dueDate',
  'deliveryDate',
  'deliveryAddress',
  'sourceDocument',
] as const;

export interface DocumentListQuery {
  type?: string;
  status?: string;
  branchId?: string;
  q?: string;
  page?: string;
  pageSize?: string;
}

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: DocumentPermissionsService,
    private readonly render: DocumentRenderService,
    private readonly print: DocumentPrintService,
    private readonly relations: DocumentRelationsService,
    private readonly sources: DocumentSourcesService,
    private readonly attachments: DocumentAttachmentsService,
  ) {}

  @Get()
  async list(
    @Query() query: DocumentListQuery,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    if (!user) throw new ForbiddenException('Not authenticated');
    const orgId = user.organizationId;

    // Permission prefilter: only types the actor can read.
    const defs = await this.prisma.client.documentTypeDef.findMany({
      orderBy: { code: 'asc' },
      include: { orgConfigs: { where: { organizationId: orgId } } },
    });
    const readable = defs.filter(
      (d) =>
        (d.orgConfigs.length === 0 || d.orgConfigs[0].isActive) &&
        this.permissions.can(user.permissions ?? [], toPermissionSubject(d), 'read'),
    );
    if (!readable.length) throw new ForbiddenException('No document types are readable');

    const readableIds = readable.map((d) => d.id);
    const typeCodeToId = new Map(defs.map((d) => [d.code, d.id]));

    const where: Prisma.DocumentWhereInput = {
      organizationId: orgId,
      documentTypeId: { in: readableIds },
    };
    if (query.type) {
      const typeId = typeCodeToId.get(query.type);
      if (!typeId) throw new BadRequestException(`Unknown document type '${query.type}'`);
      where.documentTypeId = typeId;
    }
    if (query.status) where.status = query.status as Prisma.DocumentWhereInput['status'];
    if (query.branchId) where.branchId = query.branchId;
    if (query.q?.trim()) {
      where.OR = [
        { documentNumber: { contains: query.q.trim(), mode: 'insensitive' } },
        { reference: { contains: query.q.trim(), mode: 'insensitive' } },
        { sourceDocument: { contains: query.q.trim(), mode: 'insensitive' } },
      ];
    }

    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
    const [total, items] = await Promise.all([
      this.prisma.client.document.count({ where }),
      this.prisma.client.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          organizationId: true,
          documentNumber: true,
          documentType: true,
          documentTypeId: true,
          partnerId: true,
          issueDate: true,
          dueDate: true,
          status: true,
          paymentStatus: true,
          totalAmount: true,
          amountResidual: true,
          branchId: true,
          version: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    const codeById = new Map(readable.map((d) => [d.id, d.code]));
    return {
      items: items.map((i) => ({ ...i, documentTypeCode: codeById.get(i.documentTypeId) ?? null })),
      total,
      page,
      pageSize,
    };
  }

  @Get(':id')
  async detail(@Param('id') id: string, @CurrentUser() user: AuthUser | undefined) {
    if (!user) throw new ForbiddenException('Not authenticated');
    const doc = await this.prisma.client.document.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
        partner: { select: { id: true, name: true } },
        documentTypeDef: true,
        printLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
        snapshots: { orderBy: { generatedAt: 'desc' }, take: 5 },
      },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const def = doc.documentTypeDef;
    this.requireRead(user, def);

    const { documentTypeDef, printLogs, snapshots, ...rest } = doc;
    return {
      ...rest,
      printProfile: def.printProfile,
      editPolicy: def.editPolicy,
      postingPolicy: def.postingPolicy,
      cancellationPolicy: def.cancellationPolicy,
      snapshotPolicy: def.snapshotPolicy,
      printLogs,
      snapshots: snapshots.map((s) => ({
        id: s.id,
        reason: s.reason,
        state: s.state,
        seal: s.seal,
        generatedAt: s.generatedAt,
        templateVersionId: s.templateVersionId,
      })),
    };
  }

  @Patch(':id')
  async patch(
    @Param('id') id: string,
    @Body() body: { version?: number; fields?: Record<string, unknown> },
    @CurrentUser() user: AuthUser | undefined,
  ) {
    if (!user) throw new ForbiddenException('Not authenticated');
    if (!body || body.version == null) {
      throw new BadRequestException('version is required for optimistic locking');
    }
    if (!body.fields || Object.keys(body.fields).length === 0) {
      throw new BadRequestException('fields must contain at least one patchable field');
    }
    const doc = await this.prisma.client.document.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { documentTypeDef: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    this.requireWrite(user, doc.documentTypeDef);

    const editPolicy = doc.documentTypeDef.editPolicy ?? 'EDITABLE';
    if (editPolicy === 'VERSIONED') {
      throw new UnprocessableEntityException(
        'This document type uses versioned amendments (Phase 5) — use the amend action instead',
      );
    }
    if (editPolicy === 'IMMUTABLE_AFTER_ISSUE' && doc.status !== 'draft') {
      throw new UnprocessableEntityException(
        `This document type is immutable after issue (current status '${doc.status}')`,
      );
    }

    const data: Record<string, unknown> = { updatedBy: user.sub };
    for (const key of Object.keys(body.fields)) {
      if (!(PATCHABLE_FIELDS as readonly string[]).includes(key)) {
        throw new BadRequestException(`Field '${key}' is not patchable`);
      }
      data[key] = body.fields[key];
    }
    data.version = { increment: 1 };

    const updated = await this.prisma.client.document.updateMany({
      where: { id, organizationId: user.organizationId, version: Number(body.version) },
      data: data as Prisma.DocumentUpdateManyMutationInput,
    });
    if (updated.count === 0) {
      throw new ConflictException(
        `Document was modified concurrently (expected version ${body.version}); reload and retry`,
      );
    }
    const fresh = await this.prisma.client.document.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { documentTypeDef: true },
    });
    return { id, documentNumber: fresh?.documentNumber, version: fresh?.version, updated: true };
  }

  // ---------------------------------------------------------------------------
  // Phase 4 — preview, print (log + snapshot opt-in), template admin
  // ---------------------------------------------------------------------------

  /** Live render without a print log (§4.3 preview). */
  @Get(':id/preview')
  async preview(
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    if (!user) throw new ForbiddenException('Not authenticated');
    const fmt = format ?? 'html';
    this.render.assertFormat(fmt);
    const { doc, def } = await this.loadDoc(id, user.organizationId);
    this.requireRead(user, def);
    return this.render.render(
      user.organizationId,
      doc,
      doc.lines ?? [],
      { code: def.code, name: def.name, id: def.id },
      fmt,
    );
  }

  /** Print: permission, idempotent log, reprint reason, snapshotOnPrint opt-in. */
  @Post(':id/print')
  async printDoc(
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body()
    body: {
      format?: string;
      copies?: number;
      printer?: string;
      reason?: string;
    },
    @CurrentUser() user: AuthUser | undefined,
  ) {
    if (!user) throw new ForbiddenException('Not authenticated');
    return this.print.print({
      orgId: user.organizationId,
      userId: user.sub,
      userPermissions: user.permissions ?? [],
      documentId: id,
      format: body?.format ?? 'a4',
      copies: body?.copies,
      printer: body?.printer,
      reason: body?.reason,
      idempotencyKey: idempotencyKey ?? '',
    });
  }

  @Get('templates')
  async listTemplates(
    @Query() query: { type?: string; format?: string },
    @CurrentUser() user: AuthUser | undefined,
  ) {
    if (!user) throw new ForbiddenException('Not authenticated');
    this.requireManage(user);
    const where: Prisma.TemplateDefinitionWhereInput = {
      ...(query.type ? { documentType: { code: query.type } } : {}),
      ...(query.format ? { format: query.format } : {}),
    };
    return this.prisma.client.templateDefinition.findMany({
      where,
      include: { documentType: { select: { code: true, name: true } } },
      orderBy: [{ templateKey: 'asc' }, { version: 'desc' }],
    });
  }

  /** Create a new template version for a type+format (admin surface, §4.2). */
  @Post('templates')
  async createTemplate(
    @Body()
    body: {
      typeCode: string;
      format: string;
      name?: string;
      content: string;
      engine?: string;
    },
    @CurrentUser() user: AuthUser | undefined,
  ) {
    if (!user) throw new ForbiddenException('Not authenticated');
    this.requireManage(user);
    if (!body?.typeCode || !body?.content || !body?.format) {
      throw new BadRequestException('typeCode, format and content are required');
    }
    this.render.assertFormat(body.format);
    this.render.assertEngine(body.engine ?? 'plain');
    const def = await this.prisma.client.documentTypeDef.findUnique({
      where: { code: body.typeCode },
    });
    if (!def) throw new BadRequestException(`Unknown document type '${body.typeCode}'`);

    const templateKey = `${body.typeCode}:${body.format}`;
    const latest = await this.prisma.client.templateDefinition.findFirst({
      where: { templateKey },
      orderBy: { version: 'desc' },
    });
    return this.prisma.client.templateDefinition.create({
      data: {
        templateKey,
        documentTypeId: def.id,
        format: body.format,
        engine: body.engine ?? 'plain',
        version: (latest?.version ?? 0) + 1,
        name: body.name ?? `${templateKey} v${(latest?.version ?? 0) + 1}`,
        content: body.content,
        isActive: false,
        createdById: user.sub,
      },
    });
  }

  /** Activate one template version — deactivates siblings on the same key+format. */
  @Post('templates/:id/activate')
  async activateTemplate(
    @Param('id') templateId: string,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    if (!user) throw new ForbiddenException('Not authenticated');
    this.requireManage(user);
    const tpl = await this.prisma.client.templateDefinition.findUnique({
      where: { id: templateId },
    });
    if (!tpl) throw new NotFoundException('Template not found');
    await this.prisma.client.$transaction([
      this.prisma.client.templateDefinition.updateMany({
        where: { templateKey: tpl.templateKey, format: tpl.format },
        data: { isActive: false },
      }),
      this.prisma.client.templateDefinition.update({
        where: { id: templateId },
        data: { isActive: true },
      }),
    ]);
    return { id: templateId, templateKey: tpl.templateKey, format: tpl.format, isActive: true };
  }

  // ---------------------------------------------------------------------------
  // Phase 5 — relations (§3.3/§5.2)
  // ---------------------------------------------------------------------------

  @Post(':id/relations')
  async createRelation(
    @Param('id') id: string,
    @Body()
    body: { toDocumentId?: string; documentNumber?: string; relationType: string; payload?: Record<string, unknown> },
    @CurrentUser() user: AuthUser | undefined,
  ) {
    if (!user) throw new ForbiddenException('Not authenticated');
    if (!body?.relationType) throw new BadRequestException('relationType is required');
    const target = body.toDocumentId
      ? await this.prisma.client.document.findFirst({
          where: { id: body.toDocumentId, organizationId: user.organizationId },
          select: { id: true },
        })
      : body.documentNumber
        ? await this.prisma.client.document.findFirst({
            where: { documentNumber: body.documentNumber, organizationId: user.organizationId },
            select: { id: true },
          })
        : null;
    if (!target) throw new BadRequestException('toDocumentId or documentNumber must reference an existing document');
    const doc = await this.loadDoc(id, user.organizationId);
    this.requireWrite(user, doc.def);
    return this.relations.createRelation({
      orgId: user.organizationId,
      userId: user.sub,
      fromDocumentId: id,
      toDocumentId: target.id,
      relationCode: body.relationType,
      payload: body.payload,
    });
  }

  @Get(':id/relations')
  async listRelations(@Param('id') id: string, @CurrentUser() user: AuthUser | undefined) {
    if (!user) throw new ForbiddenException('Not authenticated');
    const { def } = await this.loadDoc(id, user.organizationId);
    this.requireRead(user, def);
    return this.relations.listRelations(user.organizationId, id);
  }

  @Get(':id/relations/chain')
  async relationChain(
    @Param('id') id: string,
    @Query('type') relationType: string | undefined,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    if (!user) throw new ForbiddenException('Not authenticated');
    if (!relationType) throw new BadRequestException('?type= is required (e.g. FULFILLS)');
    const { def } = await this.loadDoc(id, user.organizationId);
    this.requireRead(user, def);
    return this.relations.relationChain(user.organizationId, id, relationType.toUpperCase());
  }

  @Delete(':id/relations/:rid')
  async deleteRelation(
    @Param('id') id: string,
    @Param('rid') relationId: string,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    if (!user) throw new ForbiddenException('Not authenticated');
    const { def } = await this.loadDoc(id, user.organizationId);
    this.requireWrite(user, def);
    return this.relations.deleteRelation(user.organizationId, id, relationId);
  }

  // ---------------------------------------------------------------------------
  // Phase 5 — sources (§5.1)
  // ---------------------------------------------------------------------------

  @Post(':id/sources')
  async addSource(
    @Param('id') id: string,
    @Body() body: { sourceType: string; sourceId: string; relationship?: 'primary' | 'related' },
    @CurrentUser() user: AuthUser | undefined,
  ) {
    if (!user) throw new ForbiddenException('Not authenticated');
    const { def } = await this.loadDoc(id, user.organizationId);
    this.requireWrite(user, def);
    return this.sources.addSource({
      orgId: user.organizationId,
      userId: user.sub,
      documentId: id,
      sourceType: body?.sourceType ?? '',
      sourceId: body?.sourceId ?? '',
      relationship: body?.relationship,
    });
  }

  @Get(':id/sources')
  async listSources(@Param('id') id: string, @CurrentUser() user: AuthUser | undefined) {
    if (!user) throw new ForbiddenException('Not authenticated');
    const { def } = await this.loadDoc(id, user.organizationId);
    this.requireRead(user, def);
    return this.sources.listSources(user.organizationId, id);
  }

  @Delete(':id/sources/:sid')
  async removeSource(
    @Param('id') id: string,
    @Param('sid') sourceId: string,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    if (!user) throw new ForbiddenException('Not authenticated');
    const { def } = await this.loadDoc(id, user.organizationId);
    this.requireWrite(user, def);
    return this.sources.removeSource(user.organizationId, id, sourceId);
  }

  // ---------------------------------------------------------------------------
  // Phase 5 — attachments (§5.4): File vault + role whitelist
  // ---------------------------------------------------------------------------

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file'))
  async attach(
    @Param('id') id: string,
    @UploadedFile() file: { originalname: string; mimetype: string; buffer: Buffer; size: number } | undefined,
    @Body() body: { role?: string; kind?: string; metadata?: Record<string, unknown> },
    @CurrentUser() user: AuthUser | undefined,
  ) {
    if (!user) throw new ForbiddenException('Not authenticated');
    if (!file?.buffer) throw new BadRequestException('multipart field "file" is required');
    const { def } = await this.loadDoc(id, user.organizationId);
    this.requireWrite(user, def);
    return this.attachments.attach(
      {
        orgId: user.organizationId,
        userId: user.sub,
        documentId: id,
        role: body?.role,
        kind: body?.kind,
        metadata: body?.metadata,
      },
      file,
    );
  }

  @Get(':id/attachments')
  async listAttachments(@Param('id') id: string, @CurrentUser() user: AuthUser | undefined) {
    if (!user) throw new ForbiddenException('Not authenticated');
    const { def } = await this.loadDoc(id, user.organizationId);
    this.requireRead(user, def);
    return this.attachments.list(user.organizationId, id);
  }

  @Delete(':id/attachments/:aid')
  async removeAttachment(
    @Param('id') id: string,
    @Param('aid') attachmentId: string,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    if (!user) throw new ForbiddenException('Not authenticated');
    const { def } = await this.loadDoc(id, user.organizationId);
    this.requireWrite(user, def);
    return this.attachments.remove(user.organizationId, id, attachmentId);
  }

  // ---------------------------------------------------------------------------
  // Phase 3+ timeline — merged actions + prints + snapshots + relations +
  // sources + versions + attachments, newest first.
  // ---------------------------------------------------------------------------

  @Get(':id/timeline')
  async timeline(@Param('id') id: string, @CurrentUser() user: AuthUser | undefined) {
    if (!user) throw new ForbiddenException('Not authenticated');
    const doc = await this.prisma.client.document.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        documentTypeDef: true,
        actions: { orderBy: { createdAt: 'asc' } },
        printLogs: { orderBy: { createdAt: 'asc' } },
        snapshots: { orderBy: { generatedAt: 'asc' } },
        sources: { orderBy: { createdAt: 'asc' } },
        relationsOut: {
          orderBy: { createdAt: 'asc' },
          include: {
            relationType: true,
            toDocument: { select: { id: true, documentNumber: true } },
          },
        },
        relationsIn: {
          orderBy: { createdAt: 'asc' },
          include: {
            relationType: true,
            fromDocument: { select: { id: true, documentNumber: true } },
          },
        },
        versions: { orderBy: { createdAt: 'asc' } },
        attachments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!doc) throw new NotFoundException('Document not found');
    this.requireRead(user, doc.documentTypeDef);

    const events = [
      ...doc.actions.map((a) => ({
        kind: 'action' as const,
        at: a.createdAt,
        action: a.action,
        status: a.status,
        requestedById: a.requestedById,
        idempotencyKey: a.idempotencyKey,
        result: a.result,
        error: a.error,
      })),
      ...doc.printLogs.map((p) => ({
        kind: 'print' as const,
        at: p.createdAt,
        action: p.action,
        printType: p.type,
        copies: p.copies,
        printedById: p.printedById,
        printer: p.printer,
        reason: p.reason,
        documentLineId: p.documentLineId,
      })),
      ...doc.snapshots.map((s) => ({
        kind: 'snapshot' as const,
        at: s.generatedAt,
        reason: s.reason,
        state: s.state,
        seal: s.seal,
        templateVersionId: s.templateVersionId,
        createdById: s.createdById,
      })),
      ...doc.sources.map((s) => ({
        kind: 'source' as const,
        at: s.createdAt,
        sourceType: s.sourceType,
        sourceId: s.sourceId,
        relationship: s.relationship,
        createdById: s.createdById,
      })),
      ...doc.relationsOut.map((r) => ({
        kind: 'relation' as const,
        at: r.createdAt,
        relationType: r.relationType.code,
        direction: 'out' as const,
        fromDocumentNumber: doc.documentNumber,
        toDocumentNumber: r.toDocument.documentNumber,
        payload: r.payload,
        createdById: r.createdById,
      })),
      ...doc.relationsIn.map((r) => ({
        kind: 'relation' as const,
        at: r.createdAt,
        relationType: r.relationType.code,
        direction: 'in' as const,
        fromDocumentNumber: r.fromDocument.documentNumber,
        toDocumentNumber: doc.documentNumber,
        payload: r.payload,
        createdById: r.createdById,
      })),
      ...doc.versions.map((v) => ({
        kind: 'version' as const,
        at: v.createdAt,
        versionNo: v.versionNo,
        changeNote: v.changeNote,
        changedById: v.changedById,
      })),
      ...doc.attachments.map((a) => ({
        kind: 'attachment' as const,
        at: a.createdAt,
        role: a.role,
        attachmentKind: a.kind,
        attachmentVersion: a.version,
        fileId: a.fileId,
        createdById: a.createdById,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    return {
      documentId: doc.id,
      documentNumber: doc.documentNumber,
      documentTypeCode: doc.documentTypeDef.code,
      status: doc.status,
      version: doc.version,
      events,
    };
  }

  // ---------------------------------------------------------------------------

  private async loadDoc(id: string, orgId: string) {
    const doc = await this.prisma.client.document.findFirst({
      where: { id, organizationId: orgId },
      include: { documentTypeDef: true, lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return { doc, def: doc.documentTypeDef };
  }

  private requireRead(user: AuthUser, subject: { code: string; category: string }) {
    if (!this.permissions.can(user.permissions ?? [], toPermissionSubject(subject), 'read')) {
      throw new ForbiddenException(`Missing document:read for '${subject.code}'`);
    }
  }

  private requireWrite(user: AuthUser, subject: { code: string; category: string }) {
    if (!this.permissions.can(user.permissions ?? [], toPermissionSubject(subject), 'update')) {
      throw new ForbiddenException(`Missing document:update for '${subject.code}'`);
    }
  }

  private requireManage(user: AuthUser) {
    if (!this.permissions.can(user.permissions ?? [], null, 'manage')) {
      throw new ForbiddenException(`Missing document:manage`);
    }
  }
}