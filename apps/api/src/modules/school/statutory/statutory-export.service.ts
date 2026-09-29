import ExcelJS from 'exceljs';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { UnebCaService, splitName } from './uneb-ca.service';
import { EXAM_LEVEL_STAGE } from './candidate-reference.service';
import { DEFAULT_TEMPLATES, STATUTORY_DATASETS, type TemplateColumn } from './statutory.datasets';
import { renderCell, renderCsv, validateColumns } from './statutory-csv';
import type {
  CreateExportTemplateDto,
  MarkSubmittedDto,
  RunExportDto,
  UpdateExportTemplateDto,
} from './statutory.dto';

/** A produced file, plus everything needed to defend it later. */
export interface ExportResult {
  runId: string;
  templateCode: string;
  templateVersion: number;
  filename: string;
  content: string;
  /** Wave 16: the same rows as an XLSX workbook, when `format: 'xlsx'` was asked for. */
  xlsx?: Buffer;
  rowCount: number;
  checksum: string;
  warnings: Array<{ code: string; detail: string; studentProfileId?: string }>;
}

const sha = (v: string): string => createHash('sha256').update(v).digest('hex');

/**
 * Configurable statutory exports (Phase 6).
 *
 * Two rules make this safe to hand to a school:
 *
 *  1. A template chooses columns from a fixed per-scope registry. It cannot
 *     reach a field the dataset builder did not put on the row, so no template
 *     edit can widen what leaves the building.
 *  2. A published template is immutable. Editing one mints the next version, and
 *     a run pins the version it used — so the file sent in March can still be
 *     read under the layout it was written with after the layout changes in May.
 *
 * The file itself is never the record of what was submitted: `StatutoryExportRun`
 * is, carrying the checksum, the filters, the row count and the readiness
 * findings that stood at the time.
 */
@Injectable()
export class StatutoryExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly ca: UnebCaService,
    private readonly placements: PlacementLookupService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /** The column vocabulary the designer offers, per dataset. */
  datasets() {
    return Object.values(STATUTORY_DATASETS);
  }

  async listTemplates(scope?: string) {
    return this.prisma.client.statutoryExportTemplate.findMany({
      where: { deletedAt: null, ...(scope ? { scope } : {}) },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
      include: { _count: { select: { runs: true } } },
    });
  }

  /**
   * Put the Uganda starting layouts in place for a school that has none.
   *
   * Idempotent by template code: a school that has already edited `UNEB_UCE_CA`
   * keeps its edits, because seeding must never be a way to lose them.
   */
  async seedDefaults() {
    const existing = await this.prisma.client.statutoryExportTemplate.findMany({
      where: { deletedAt: null },
      select: { code: true },
    });
    const have = new Set(existing.map((e) => e.code));
    const created: string[] = [];

    for (const template of DEFAULT_TEMPLATES) {
      if (have.has(template.code)) continue;
      await this.prisma.client.statutoryExportTemplate.create({
        data: {
          organizationId: this.org,
          code: template.code,
          name: template.name,
          description: template.description,
          board: template.board,
          level: template.level,
          scope: template.scope,
          columns: template.columns as never,
          version: 1,
          isActive: true,
          publishedAt: new Date(),
          createdBy: this.tenant.userId ?? null,
        },
      });
      created.push(template.code);
    }
    return { created, skipped: DEFAULT_TEMPLATES.length - created.length };
  }

  async createTemplate(dto: CreateExportTemplateDto) {
    this.assertColumns(dto.scope, dto.columns);
    const clash = await this.prisma.client.statutoryExportTemplate.findFirst({
      where: { code: dto.code, deletedAt: null },
      orderBy: { version: 'desc' },
    });
    if (clash) throw new ConflictException(`A template with code ${dto.code} already exists. Edit it to mint a new version.`);

    const row = await this.prisma.client.statutoryExportTemplate.create({
      data: {
        organizationId: this.org,
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        board: dto.board ?? 'UNEB',
        level: dto.level ?? null,
        scope: dto.scope,
        programmeId: dto.programmeId ?? null,
        delimiter: dto.delimiter ?? ',',
        includeHeader: dto.includeHeader ?? true,
        columns: dto.columns as never,
        version: 1,
        publishedAt: new Date(),
        createdBy: this.tenant.userId ?? null,
      },
    });
    await this.audit.record({ entity: 'StatutoryExportTemplate', entityId: row.id, action: 'create', newValues: row });
    return row;
  }

  /**
   * Edit a template by minting its next version.
   *
   * The current version is left exactly as it was and deactivated, so every
   * historical run still resolves the layout it names.
   */
  async updateTemplate(id: string, dto: UpdateExportTemplateDto) {
    const current = await this.prisma.client.statutoryExportTemplate.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw new NotFoundException('Export template not found.');

    const columns = (dto.columns ?? (current.columns as unknown as TemplateColumn[])) as TemplateColumn[];
    this.assertColumns(current.scope, columns);

    // A template nobody has exported with is still a draft in practice; editing
    // it in place keeps the version list readable instead of filling it with
    // versions that never produced a file.
    const runs = await this.prisma.client.statutoryExportRun.count({ where: { templateId: id } });
    if (runs === 0) {
      const updated = await this.prisma.client.statutoryExportTemplate.update({
        where: { id },
        data: {
          name: dto.name ?? current.name,
          description: dto.description ?? current.description,
          delimiter: dto.delimiter ?? current.delimiter,
          includeHeader: dto.includeHeader ?? current.includeHeader,
          isActive: dto.isActive ?? current.isActive,
          columns: columns as never,
          updatedBy: this.tenant.userId ?? null,
        },
      });
      await this.audit.record({ entity: 'StatutoryExportTemplate', entityId: id, action: 'update', oldValues: current, newValues: updated });
      return updated;
    }

    const next = await this.prisma.client.$transaction(async (tx: any) => {
      await tx.statutoryExportTemplate.update({ where: { id }, data: { isActive: false } });
      return tx.statutoryExportTemplate.create({
        data: {
          organizationId: this.org,
          code: current.code,
          name: dto.name ?? current.name,
          description: dto.description ?? current.description,
          board: current.board,
          level: current.level,
          scope: current.scope,
          programmeId: current.programmeId,
          delimiter: dto.delimiter ?? current.delimiter,
          includeHeader: dto.includeHeader ?? current.includeHeader,
          columns: columns as never,
          version: current.version + 1,
          isActive: dto.isActive ?? true,
          publishedAt: new Date(),
          createdBy: this.tenant.userId ?? null,
        },
      });
    });
    await this.audit.record({ entity: 'StatutoryExportTemplate', entityId: next.id, action: 'create', oldValues: current, newValues: next });
    return next;
  }

  /** Rows the template would render, without producing or recording a file. */
  async preview(dto: RunExportDto, limit = 25) {
    const { template, rows, warnings } = await this.build(dto);
    const columns = template.columns as unknown as TemplateColumn[];
    return {
      template: { id: template.id, code: template.code, version: template.version, scope: template.scope },
      columns: columns.map((c) => c.header),
      rowCount: rows.length,
      warnings,
      rows: rows.slice(0, limit).map((row) => columns.map((c) => this.cell(row, c))),
    };
  }

  /** Produce the file and record the run. */
  async run(dto: RunExportDto): Promise<ExportResult> {
    const { template, rows, warnings, blocking } = await this.build(dto);

    if (blocking.length > 0 && !dto.allowIncomplete) {
      throw new ConflictException({
        message: 'The readiness board has blocking findings. Clear them, or run the export with allowIncomplete and a reason.',
        blocking: blocking.slice(0, 50),
        blockingCount: blocking.length,
      });
    }
    if (dto.allowIncomplete && !dto.reason) {
      throw new BadRequestException('An incomplete submission needs a reason on the record.');
    }

    const columns = template.columns as unknown as TemplateColumn[];
    const content = this.render(rows, columns, template.delimiter, template.includeHeader);
    const checksum = sha(content);

    const run = await this.prisma.client.statutoryExportRun.create({
      data: {
        organizationId: this.org,
        templateId: template.id,
        templateVersion: template.version,
        scope: template.scope,
        academicYearId: dto.academicYearId ?? null,
        termId: dto.termId ?? null,
        examId: dto.examId ?? null,
        programmeId: dto.programmeId ?? null,
        classIds: (dto.classIds ?? []) as never,
        rowCount: rows.length,
        checksum,
        warnings: [...warnings, ...(dto.allowIncomplete ? blocking : [])] as never,
        generatedById: this.tenant.userId ?? null,
      },
    });

    await this.audit.record({
      entity: 'StatutoryExportRun',
      entityId: run.id,
      action: 'create',
      newValues: {
        template: template.code,
        version: template.version,
        rowCount: rows.length,
        checksum,
        allowIncomplete: dto.allowIncomplete ?? false,
        reason: dto.reason ?? null,
      },
    });

    // The checksum is always of the canonical CSV rendering, so it identifies the
    // data whichever container carried it (a zip-based xlsx is not byte-stable).
    const xlsx = dto.format === 'xlsx' ? await this.workbook(template.code, rows, columns, template.includeHeader) : undefined;
    return {
      runId: run.id,
      templateCode: template.code,
      templateVersion: template.version,
      filename: `${template.code}_${new Date().toISOString().slice(0, 10)}.${xlsx ? 'xlsx' : 'csv'}`,
      content,
      xlsx,
      rowCount: rows.length,
      checksum,
      warnings: [...warnings, ...(dto.allowIncomplete ? blocking : [])],
    };
  }

  async listRuns(scope?: string) {
    return this.prisma.client.statutoryExportRun.findMany({
      where: { ...(scope ? { scope } : {}) },
      orderBy: { generatedAt: 'desc' },
      take: 200,
      include: { template: { select: { code: true, name: true, board: true, level: true } } },
    });
  }

  /**
   * Record that a run's file was actually sent.
   *
   * The board's acknowledgement reference is the only thing that distinguishes a
   * file produced from a file submitted, and only the submitted one matters when
   * a candidate's marks are queried.
   */
  async markSubmitted(runId: string, dto: MarkSubmittedDto) {
    const run = await this.prisma.client.statutoryExportRun.findFirst({ where: { id: runId } });
    if (!run) throw new NotFoundException('Export run not found.');
    if (run.status === 'submitted') throw new ConflictException('This run is already recorded as submitted.');

    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      // Only one run per (template, term) is the live submission; earlier ones
      // are superseded so the record cannot claim two files were both sent.
      await tx.statutoryExportRun.updateMany({
        where: { templateId: run.templateId, termId: run.termId, status: 'submitted', id: { not: runId } },
        data: { status: 'superseded' },
      });
      return tx.statutoryExportRun.update({
        where: { id: runId },
        data: {
          status: 'submitted',
          submittedAt: new Date(),
          submittedById: this.tenant.userId ?? null,
          submissionReference: dto.submissionReference,
        },
      });
    });
    await this.audit.record({ entity: 'StatutoryExportRun', entityId: runId, action: 'update', oldValues: run, newValues: updated });
    return updated;
  }

  // ── dataset builders ───────────────────────────────────────────────────────

  private async build(dto: RunExportDto) {
    const template = await this.prisma.client.statutoryExportTemplate.findFirst({
      where: { id: dto.templateId, deletedAt: null },
    });
    if (!template) throw new NotFoundException('Export template not found.');

    switch (template.scope) {
      case 'uneb_ca':
        return { template, ...(await this.buildCaRows(dto, template.level)) };
      case 'candidate_register':
        return { template, ...(await this.buildRegisterRows(dto, template.level)) };
      case 'results_summary':
        return { template, ...(await this.buildResultRows(dto)) };
      default:
        throw new BadRequestException(`Template scope '${template.scope}' has no dataset builder.`);
    }
  }

  private async buildCaRows(dto: RunExportDto, templateLevel: string | null) {
    const level = dto.level ?? templateLevel;
    if (!dto.termId) throw new BadRequestException('A continuous-assessment export needs a term.');
    if (!level) throw new BadRequestException('A continuous-assessment export needs an examination level.');

    const { rows, board } = await this.ca.caRows({
      termId: dto.termId,
      level,
      registrationYear: dto.registrationYear,
      classIds: dto.classIds,
    });

    const blocking = ('candidates' in board ? board.candidates : [])
      .flatMap((c) => c.findings.filter((f) => f.severity === 'blocking'))
      .map((f) => ({ code: f.code, detail: f.detail, studentProfileId: f.studentProfileId }));
    const warnings = ('candidates' in board ? board.candidates : [])
      .flatMap((c) => c.findings.filter((f) => f.severity === 'warning'))
      .map((f) => ({ code: f.code, detail: f.detail, studentProfileId: f.studentProfileId }));

    // A blocked candidate's row is dropped from the file, not exported half-
    // filled: a board reads a blank CA score as a zero.
    return { rows: rows.filter((r) => r.ready) as Array<Record<string, unknown>>, warnings, blocking };
  }

  private async buildRegisterRows(dto: RunExportDto, templateLevel: string | null) {
    const level = dto.level ?? templateLevel;
    if (!level) throw new BadRequestException('A candidate register needs an examination level.');
    const stage = EXAM_LEVEL_STAGE[level];
    if (!stage) throw new BadRequestException(`Unknown examination level '${level}'.`);
    const registrationYear = dto.registrationYear ?? new Date().getFullYear();

    const references = await this.prisma.client.studentExamReference.findMany({
      where: { level, registrationYear, deletedAt: null, status: { not: 'withdrawn' } },
      orderBy: { candidateNumber: 'asc' },
    });
    if (references.length === 0) return { rows: [], warnings: [], blocking: [] };

    const learners = await this.prisma.client.studentProfile.findMany({
      where: {
        id: { in: references.map((r) => r.studentProfileId) },
        deletedAt: null,
        // A statutory submission leaves the school and cannot be recalled, so it
        // must name the class the learner actually held (ADR-027).
        ...(dto.classIds?.length ? this.placements.studentWhere({ classIds: dto.classIds }) : {}),
      },
      select: {
        id: true,
        admissionNo: true,
        gender: true,
        dateOfBirth: true,
        partner: { select: { name: true } },
      },
    });
    const byId = new Map(learners.map((l) => [l.id, l]));
    // A statutory submission leaves the school and cannot be recalled: it names
    // the class and stream from placement history (ADR-027).
    const placedCandidates = await this.placements.describe(learners.map((l) => l.id));

    const enrollments = await this.prisma.client.studentEnrollment.findMany({
      where: { studentProfileId: { in: learners.map((l) => l.id) }, status: 'ACTIVE' },
      select: { studentProfileId: true, programme: { select: { code: true } } },
    });
    const programmeByStudent = new Map(enrollments.map((e) => [e.studentProfileId, e.programme?.code ?? null]));

    const blocking: Array<{ code: string; detail: string; studentProfileId?: string }> = [];
    const rows: Array<Record<string, unknown>> = [];

    for (const ref of references) {
      const learner = byId.get(ref.studentProfileId);
      if (!learner) continue;
      if (!ref.candidateNumber) {
        blocking.push({ code: 'NO_CANDIDATE_NUMBER', detail: `${learner.partner?.name ?? learner.admissionNo} has no candidate number.`, studentProfileId: learner.id });
        continue;
      }
      if (!ref.centreNumber) {
        blocking.push({ code: 'NO_CENTRE_NUMBER', detail: `${learner.partner?.name ?? learner.admissionNo} has no centre number.`, studentProfileId: learner.id });
        continue;
      }
      const { surname, otherNames } = splitName(learner.partner?.name ?? null);
      rows.push({
        centreNumber: ref.centreNumber,
        candidateNumber: ref.candidateNumber,
        indexNumber: ref.indexNumber,
        studentName: learner.partner?.name ?? null,
        surname,
        otherNames,
        sex: learner.gender?.trim().toUpperCase().startsWith('F') ? 'F' : learner.gender ? 'M' : null,
        dateOfBirth: learner.dateOfBirth,
        admissionNo: learner.admissionNo,
        className: placedCandidates.get(learner.id)?.className ?? null,
        streamName: placedCandidates.get(learner.id)?.sectionName ?? null,
        programmeCode: programmeByStudent.get(learner.id) ?? null,
        referenceStatus: ref.status,
        registrationYear: ref.registrationYear,
      });
    }
    return { rows, warnings: [], blocking };
  }

  private async buildResultRows(dto: RunExportDto) {
    if (!dto.termId) throw new BadRequestException('A results export needs a term.');

    // Published sets only, latest revision per scope: a district return built
    // from a draft calculation is a number nobody agreed to.
    const sets = await this.prisma.client.resultSet.findMany({
      where: { termId: dto.termId, status: 'published', deletedAt: null },
      orderBy: { revision: 'desc' },
      select: { id: true, scopeId: true, revision: true, publishedAt: true },
    });
    if (sets.length === 0) return { rows: [], warnings: [], blocking: [{ code: 'NO_PUBLISHED_RESULTS', detail: 'No published result set exists for this term.' }] };

    const latestByScope = new Map<string, (typeof sets)[number]>();
    for (const s of sets) {
      const key = s.scopeId ?? 'all';
      if (!latestByScope.has(key)) latestByScope.set(key, s);
    }
    const setIds = [...latestByScope.values()].map((s) => s.id);
    const setById = new Map([...latestByScope.values()].map((s) => [s.id, s]));

    const results = await this.prisma.client.studentTermResult.findMany({
      where: { resultSetId: { in: setIds }, ...(dto.classIds?.length ? { classId: { in: dto.classIds } } : {}) },
      orderBy: [{ classId: 'asc' }, { classRank: 'asc' }],
    });
    if (results.length === 0) return { rows: [], warnings: [], blocking: [] };

    const learners = await this.prisma.client.studentProfile.findMany({
      where: { id: { in: results.map((r) => r.studentProfileId) } },
      select: {
        id: true,
        admissionNo: true,
        partner: { select: { name: true } },
      },
    });
    const byId = new Map(learners.map((l) => [l.id, l]));

    const references = await this.prisma.client.studentExamReference.findMany({
      where: { studentProfileId: { in: results.map((r) => r.studentProfileId) }, deletedAt: null },
      orderBy: { registrationYear: 'desc' },
      select: { studentProfileId: true, candidateNumber: true },
    });
    const candidateNo = new Map<string, string | null>();
    for (const r of references) if (!candidateNo.has(r.studentProfileId)) candidateNo.set(r.studentProfileId, r.candidateNumber);

    const term = await this.prisma.client.term.findFirst({ where: { id: dto.termId }, select: { name: true } });
    const placedResults = await this.placements.describe(
      [...new Set(results.map((r) => r.studentProfileId))],
      { termId: dto.termId },
    );

    const rows = results.map((r) => {
      const learner = byId.get(r.studentProfileId);
      const set = setById.get(r.resultSetId);
      return {
        studentName: learner?.partner?.name ?? null,
        admissionNo: learner?.admissionNo ?? null,
        candidateNumber: candidateNo.get(r.studentProfileId) ?? null,
        className: placedResults.get(r.studentProfileId)?.className ?? null,
        streamName: placedResults.get(r.studentProfileId)?.sectionName ?? null,
        termName: term?.name ?? null,
        meanPercent: r.meanPercent == null ? null : Number(r.meanPercent),
        aggregate: r.aggregate,
        division: r.division,
        gpa: r.gpa == null ? null : Number(r.gpa),
        classRank: r.classRank,
        promotionRecommendation: r.promotionRecommendation,
        resultSetRevision: set?.revision ?? null,
        publishedAt: set?.publishedAt ?? null,
      };
    });
    return { rows: rows as Array<Record<string, unknown>>, warnings: [], blocking: [] };
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  private assertColumns(scope: string, columns: TemplateColumn[]) {
    const problems = validateColumns(scope, columns);
    if (problems.length > 0) throw new BadRequestException(problems.join(' '));
  }

  private cell(row: Record<string, unknown>, column: TemplateColumn): string {
    return renderCell(row, column);
  }

  private render(rows: Array<Record<string, unknown>>, columns: TemplateColumn[], delimiter: string, includeHeader: boolean): string {
    return renderCsv(rows, columns, delimiter, includeHeader);
  }

  /** Same cells as the CSV, as text, one sheet, header frozen. */
  private async workbook(code: string, rows: Array<Record<string, unknown>>, columns: TemplateColumn[], includeHeader: boolean): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(code.slice(0, 31));
    if (includeHeader) {
      ws.addRow(columns.map((c) => c.header)).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    }
    for (const row of rows) ws.addRow(columns.map((c) => this.cell(row, c)));
    ws.columns.forEach((col, i) => {
      col.numFmt = '@';
      col.width = Math.min(40, Math.max(10, String(columns[i]?.header ?? '').length + 2));
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
