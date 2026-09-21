import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { ReportCardTemplateService } from './report-card-template.service';
import { ReportCardSettingsService } from './report-card-settings.service';
import { GradingService, type GradeBand } from './grading.service';
import { ResultRunService } from '../assessment/result-run.service';
import type { ColumnItem } from './report-card-settings.schema';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';

/**
 * ReportCardPdfService — renders a student's report card to PDF.
 *
 * Every visual decision is delegated to the org's ReportCardSettings: page
 * size and margins, typography, the colour palette, which biodata fields and
 * table columns print, the order of the body blocks, comment/signature/footer
 * copy and the watermark. The renderer holds no hard-coded layout constants
 * beyond sensible fallbacks — see report-card-settings.schema.ts for the
 * registry that defines each option.
 *
 * Used by GET /school/report-cards/:id/pdf.
 */

const MM = 2.834645669; // millimetres → PostScript points

const FONT_SETS: Record<string, { regular: string; bold: string; italic: string; boldItalic: string }> = {
  helvetica: { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', boldItalic: 'Helvetica-BoldOblique' },
  times: { regular: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic', boldItalic: 'Times-BoldItalic' },
  courier: { regular: 'Courier', bold: 'Courier-Bold', italic: 'Courier-Oblique', boldItalic: 'Courier-BoldOblique' },
};

const DENSITY: Record<string, number> = { compact: 0.65, normal: 1, relaxed: 1.45 };

/** Everything the renderer needs, already resolved from the database. */
interface RenderModel {
  settings: Record<string, any>;
  school: { name: string; motto?: string; address?: string; phone?: string; email?: string; website?: string; logoUrl?: string };
  student: {
    name: string; admissionNo: string; gender: string; className: string; stream: string;
    dateOfBirth?: Date | null; house?: string | null; photoUrl?: string;
  };
  term: { name: string; startDate?: Date | null; endDate?: Date | null; academicYear?: string };
  layout: {
    system?: string;
    columnHeaders: string[];
    sections: Array<{ title: string; subjects: any[] }>;
    summary: Array<{ label: string; value: string }>;
    eligible?: { qualifies: boolean; reason: string };
    footer?: string[];
  };
  stats: { gpa?: number; rank?: number; classSize?: number; meanPercent?: number; division?: string | null; aggregate?: string | null };
  comments: { classTeacher?: string | null; headTeacher?: string | null; competency?: string | null };
  attendance: { present: number; absent: number; late: number; total: number };
  gradeBands: GradeBand[];
  verificationCode: string;
  generatedAt: Date;
}

@Injectable()
export class ReportCardPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly templates: ReportCardTemplateService,
    private readonly settingsService: ReportCardSettingsService,
    private readonly grading: GradingService,
    private readonly results: ResultRunService,
    private readonly placements: PlacementLookupService,
  ) {}

  async generatePdf(reportCardId: string): Promise<Buffer> {
    const model = await this.loadModel(reportCardId);
    return this.render(model);
  }

  /**
   * One printable document for a whole class.
   *
   * A class of sixty was sixty separate downloads, which is not how report cards
   * get handed out. Each card still renders exactly as it does on its own — same
   * layout, same settings — just onto a shared document with a page break
   * between pupils, so it goes to the printer once.
   */
  async generateClassPdf(reportCardIds: string[]): Promise<Buffer> {
    if (reportCardIds.length === 0) {
      throw new NotFoundException('No report cards to print.');
    }
    const models: RenderModel[] = [];
    for (const id of reportCardIds) models.push(await this.loadModel(id));
    return this.render(models);
  }

  // ── Data loading ───────────────────────────────────────────────────────

  private async loadModel(reportCardId: string): Promise<RenderModel> {
    const card = await this.prisma.client.reportCard.findFirst({ where: { id: reportCardId } });
    if (!card) throw new NotFoundException(`ReportCard ${reportCardId} not found`);

    const profile = await this.prisma.client.studentProfile.findFirst({
      where: { id: card.studentProfileId },
    });
    // Class and stream from placement history for the card's term (ADR-027): a
    // card printed after a pupil moved must still name the class they sat in.
    const placed = profile
      ? (await this.placements.describe([profile.id], { termId: card.termId })).get(profile.id)
      : undefined;
    const [partner, term, school, settings] = await Promise.all([
      profile ? this.prisma.client.partner.findFirst({ where: { id: profile.partnerId } }) : Promise.resolve(null),
      this.prisma.client.term.findFirst({ where: { id: card.termId }, include: { academicYear: true } }),
      this.prisma.client.schoolProfile.findFirst({ where: { organizationId: this.tenant.organizationId } }),
      this.settingsService.get(),
    ]);

    // Prefer the layout frozen into the payload; rebuild only for cards that
    // predate the template upgrade.
    //
    // A rebuild MUST be handed the published result spine, exactly as
    // `ReportCardService.generate` does. Calling `buildLayout` without it left
    // `spineSubjects` empty, which sent every rebuilt card down the legacy
    // GradeEntry path — so a re-rendered PDF could disagree with the card the
    // parent was shown. Since B6, `buildLayout` reads ONLY the spine, so a
    // rebuild with no published result falls through to the live-spine view
    // rather than to GradeEntry.
    const stored: any = card.payload ?? {};
    const spine = stored?.sections
      ? null
      : await this.results.latestPublished(card.termId, card.studentProfileId).catch(() => null);
    const layout = stored?.sections
      ? {
          system: stored.system ?? undefined,
          columnHeaders: stored.columnHeaders ?? [],
          sections: stored.sections ?? [],
          summary: stored.summary ?? [],
          eligible: stored.eligible,
          footer: stored.footer,
        }
      : (await this.templates.buildLayout(card.studentProfileId, card.termId, spine)).layout;

    const [attendance, gradeBands] = await Promise.all([
      this.loadAttendance(card.studentProfileId, term?.startDate, term?.endDate),
      this.grading.bandsFor(school?.gradingSystem).catch(() => [] as GradeBand[]),
    ]);

    return {
      settings: settings as Record<string, any>,
      school: {
        name: school?.name ?? 'School',
        motto: school?.motto ?? undefined,
        address: school?.address ?? undefined,
        phone: school?.phone ?? undefined,
        email: school?.email ?? undefined,
        website: school?.website ?? undefined,
        logoUrl: school?.logoUrl ?? undefined,
      },
      student: {
        name: partner?.name ?? 'Student',
        admissionNo: profile?.admissionNo ?? '—',
        gender: profile?.gender ?? '—',
        className: placed?.className ?? '—',
        stream: placed?.sectionName ?? '—',
        dateOfBirth: profile?.dateOfBirth ?? null,
        house: profile?.house ?? null,
      },
      term: {
        name: term?.name ?? '—',
        startDate: term?.startDate ?? null,
        endDate: term?.endDate ?? null,
        academicYear: (term as any)?.academicYear?.name ?? undefined,
      },
      layout,
      stats: {
        gpa: stored?.gpa ?? undefined,
        rank: stored?.rank ?? undefined,
        meanPercent: stored?.meanPercent ?? undefined,
        division: stored?.division ?? null,
        aggregate: this.aggregateFromSummary(layout.summary),
      },
      comments: {
        classTeacher: card.classTeacherComment ? String(card.classTeacherComment) : null,
        headTeacher: card.principalComment ? String(card.principalComment) : null,
        competency: await this.competencySummary(card.competencyLevels as Record<string, string> | null),
      },
      attendance,
      gradeBands,
      // Short, stable, non-guessable-enough token for a parent to quote when
      // verifying a printed card against the portal.
      verificationCode: String(card.id).replace(/-/g, '').slice(0, 10).toUpperCase(),
      generatedAt: card.generatedAt,
    };
  }

  /** Present / absent / late tallies for the term, using the org's status config. */
  private async loadAttendance(
    studentProfileId: string,
    from?: Date | null,
    to?: Date | null,
  ): Promise<{ present: number; absent: number; late: number; total: number }> {
    const empty = { present: 0, absent: 0, late: 0, total: 0 };
    if (!from || !to) return empty;
    try {
      const [records, configs] = await Promise.all([
        this.prisma.client.studentAttendance.findMany({
          where: { studentProfileId, date: { gte: from, lte: to } },
          select: { status: true },
        }),
        this.prisma.client.attendanceStatusConfig.findMany({
          select: { code: true, isPresent: true, isLate: true, isAbsent: true },
        }),
      ]);
      const byCode = new Map(configs.map((c: any) => [c.code, c]));
      const out = { ...empty, total: records.length };
      for (const r of records) {
        const cfg: any = byCode.get(r.status);
        // Fall back to the conventional codes when a status has no config row.
        if (cfg ? cfg.isLate : r.status === 'late') out.late += 1;
        else if (cfg ? cfg.isAbsent : r.status === 'absent') out.absent += 1;
        else if (cfg ? cfg.isPresent : r.status === 'present') out.present += 1;
      }
      return out;
    } catch {
      return empty;
    }
  }

  private async competencySummary(levels: Record<string, string> | null): Promise<string | null> {
    const entries = Object.entries(levels ?? {});
    if (entries.length === 0) return null;
    const comps = await this.prisma.client.competency.findMany({ where: { id: { in: entries.map(([id]) => id) } } });
    const byId = new Map(comps.map((c: any) => [c.id, c.code ?? c.description ?? c.id]));
    return entries.map(([id, level]) => `${byId.get(id) ?? id}: ${level}`).join('   •   ');
  }

  /** UCE/UACE aggregates arrive as a summary row; surface it as a stat. */
  private aggregateFromSummary(summary: Array<{ label: string; value: string }>): string | null {
    const hit = (summary ?? []).find((s) => /aggregate/i.test(s.label));
    return hit ? hit.value : null;
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  private render(input: RenderModel | RenderModel[]): Promise<Buffer> {
    const models = Array.isArray(input) ? input : [input];
    // Page geometry, fonts and watermark come from the school's settings, which
    // are the same for every card in a run, so the first model defines the
    // document and each pupil is a fresh page inside it.
    const m = models[0];
    const s = m.settings;
    const fonts = FONT_SETS[String(s.fontFamily)] ?? FONT_SETS.helvetica;
    const gap = DENSITY[String(s.density)] ?? 1;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: String(s.pageSize || 'A4'),
        layout: s.orientation === 'landscape' ? 'landscape' : 'portrait',
        bufferPages: true, // needed to stamp "Page n of m" once the count is known
        margins: {
          top: num(s.marginTopMm, 12) * MM,
          right: num(s.marginRightMm, 12) * MM,
          bottom: num(s.marginBottomMm, 12) * MM,
          left: num(s.marginLeftMm, 12) * MM,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const width = right - left;

      // Watermark sits underneath the content, so it must be painted as each
      // page opens rather than at the end.
      const paintWatermark = () => {
        if (!s.showWatermark) return;
        const text = String(s.watermarkText || 'OFFICIAL');
        doc.save();
        doc.rotate(num(s.watermarkRotation, -30), { origin: [doc.page.width / 2, doc.page.height / 2] });
        doc.fillColor(hex(s.watermarkColor, '#1f2937'))
          .fillOpacity(clamp(num(s.watermarkOpacity, 0.08), 0.01, 0.5))
          .font(fonts.bold)
          .fontSize(num(s.watermarkSize, 72))
          .text(text, 0, doc.page.height / 2 - num(s.watermarkSize, 72) / 2, {
            width: doc.page.width,
            align: 'center',
          });
        doc.fillOpacity(1).restore();
      };
      doc.on('pageAdded', () => {
        paintWatermark();
        doc.x = left;
        doc.y = doc.page.margins.top;
      });
      paintWatermark();
      doc.y = doc.page.margins.top;

      const blocks = enabledKeys(s.blockOrder, ['studentInfo', 'marksTable', 'summary', 'comments', 'signatures']);

      models.forEach((model, i) => {
        // `pageAdded` already repaints the watermark and resets the cursor.
        if (i > 0) doc.addPage();

        const ctx: Ctx = { doc, s, fonts, gap, left, right, width, m: model };

        // ── Header is fixed at the top of the pupil's first page; body blocks
        //    follow the configured order.
        this.drawHeader(ctx);

        for (const block of blocks) {
          switch (block) {
            case 'studentInfo': this.drawStudentInfo(ctx); break;
            case 'marksTable': this.drawMarksTable(ctx); break;
            case 'summary': this.drawSummary(ctx); break;
            case 'gradeKey': this.drawGradeKey(ctx); break;
            case 'attendance': this.drawAttendance(ctx); break;
            case 'conduct': this.drawConduct(ctx); break;
            case 'coCurricular': this.drawCoCurricular(ctx); break;
            case 'fees': this.drawFees(ctx); break;
            case 'comments': this.drawComments(ctx); break;
            case 'nextTerm': this.drawNextTerm(ctx); break;
            case 'signatures': this.drawSignatures(ctx); break;
            default: break;
          }
        }
      });

      // Page furniture last, so it lands on every buffered page.
      this.decoratePages({ doc, s, fonts, gap, left, right, width, m });
      doc.end();
    });
  }

  // ── Header ─────────────────────────────────────────────────────────────

  private drawHeader(c: Ctx): void {
    const { doc, s, fonts, m, left, width } = c;
    const layout = String(s.headerLayout || 'centered');
    const logoBox = s.showSchoolLogo ? num(s.logoSize, 64) : 0;
    const top = doc.y;

    if (layout === 'banner') {
      const bandH = num(s.schoolNameFontSize, 18) + num(s.baseFontSize, 9.5) * 3 + 22;
      doc.rect(left - 6, top - 6, width + 12, bandH).fill(hex(s.accentColor, '#1f2937'));
      doc.y = top + 4;
    }
    const onBanner = layout === 'banner';
    const nameColor = onBanner ? '#ffffff' : hex(s.schoolNameColor, '#0f172a');
    const subColor = onBanner ? '#e2e8f0' : hex(s.schoolAddressColor, '#475569');

    // Logos.
    if (s.showSchoolLogo && layout !== 'minimal') {
      if (layout === 'logo-left' || layout === 'logo-both') {
        this.drawLogo(c, left, top, logoBox);
        if (layout === 'logo-both') this.drawLogo(c, c.right - logoBox, top, logoBox);
      } else if (layout === 'centered') {
        this.drawLogo(c, left + width / 2 - logoBox / 2, top, logoBox);
        doc.y = top + logoBox + 4;
      }
    }

    const textLeft = layout === 'logo-left' || layout === 'logo-both' ? left + logoBox + 10 : left;
    const textWidth = layout === 'logo-both' ? width - logoBox * 2 - 20
      : layout === 'logo-left' ? width - logoBox - 10
        : width;
    const align: 'left' | 'center' = layout === 'logo-left' ? 'left' : 'center';

    doc.font(fonts.bold).fontSize(num(s.schoolNameFontSize, 18)).fillColor(nameColor);
    doc.text(cased(m.school.name, s.headingCase), textLeft, doc.y, {
      width: tw(textWidth),
      align,
      characterSpacing: num(s.letterSpacing, 0.4),
    });

    if (layout !== 'minimal') {
      const sub = num(s.baseFontSize, 9.5) - 0.5;
      if (s.showSchoolMotto && m.school.motto) {
        doc.font(fonts.italic).fontSize(sub).fillColor(subColor)
          .text(`“${m.school.motto}”`, textLeft, doc.y + 1, { width: tw(textWidth), align });
      }
      if (s.showSchoolAddress && m.school.address) {
        doc.font(fonts.regular).fontSize(sub).fillColor(subColor)
          .text(m.school.address, textLeft, doc.y + 1, { width: tw(textWidth), align });
      }
      const contact: Array<{ text: string; color: string }> = [];
      if (s.showSchoolPhone && m.school.phone) contact.push({ text: `Tel: ${m.school.phone}`, color: onBanner ? '#e2e8f0' : hex(s.contactColor, '#475569') });
      if (s.showSchoolEmail && m.school.email) contact.push({ text: m.school.email, color: onBanner ? '#e2e8f0' : hex(s.emailColor, '#1d4ed8') });
      if (s.showSchoolWebsite && m.school.website) contact.push({ text: m.school.website, color: onBanner ? '#e2e8f0' : hex(s.websiteColor, '#1d4ed8') });
      // Rendered as one run so the three parts stay on a single centred line.
      if (contact.length) {
        doc.fontSize(sub).font(fonts.regular);
        const y = doc.y + 1;
        const joined = contact.map((x) => x.text).join('   ·   ');
        doc.fillColor(contact[0].color).text(joined, textLeft, y, { width: tw(textWidth), align });
      }
    }

    // Keep the header box tall enough to clear a side logo.
    if (layout === 'logo-left' || layout === 'logo-both') doc.y = Math.max(doc.y, top + logoBox);

    // Student photo pinned into the header corner.
    if (s.showStudentPhoto && String(s.studentPhotoPosition).startsWith('header')) {
      const size = num(s.studentPhotoSize, 72);
      const px = s.studentPhotoPosition === 'header-left' ? left : c.right - size;
      this.drawPhotoBox(c, px, top, size);
      doc.y = Math.max(doc.y, top + size);
    }

    // Report title.
    doc.moveDown(0.4 * c.gap);
    const title = interpolate(String(s.reportTitle || 'STUDENT PROGRESS REPORT'), m);
    doc.font(fonts.bold).fontSize(num(s.titleFontSize, 13)).fillColor(hex(s.reportTitleColor, '#0f172a'));
    doc.text(cased(title, s.headingCase), left, doc.y, {
      width,
      align: (s.titleAlignment as any) || 'center',
      underline: Boolean(s.showTitleUnderline),
      characterSpacing: num(s.letterSpacing, 0.4),
    });
    if (s.reportSubtitle) {
      doc.font(fonts.regular).fontSize(num(s.baseFontSize, 9.5)).fillColor(hex(s.labelColor, '#64748b'))
        .text(interpolate(String(s.reportSubtitle), m), left, doc.y + 1, { width, align: (s.titleAlignment as any) || 'center' });
    }
    doc.moveDown(0.3 * c.gap);
    this.rule(c);
  }

  /** Logo from a data: URI, else a lettered placeholder disc. */
  private drawLogo(c: Ctx, x: number, y: number, size: number): void {
    const { doc, s, m, fonts } = c;
    const img = dataUriToBuffer(m.school.logoUrl);
    if (img) {
      try {
        doc.save();
        if (s.logoShape === 'circle') doc.circle(x + size / 2, y + size / 2, size / 2).clip();
        else if (s.logoShape === 'rounded') doc.roundedRect(x, y, size, size, size * 0.15).clip();
        doc.image(img, x, y, { fit: [size, size], align: 'center', valign: 'center' });
        doc.restore();
        return;
      } catch {
        doc.restore();
      }
    }
    const initials = m.school.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    doc.save().lineWidth(1).strokeColor(hex(s.accentColor, '#1f2937'));
    if (s.logoShape === 'circle') doc.circle(x + size / 2, y + size / 2, size / 2).stroke();
    else if (s.logoShape === 'rounded') doc.roundedRect(x, y, size, size, size * 0.15).stroke();
    else doc.rect(x, y, size, size).stroke();
    doc.font(fonts.bold).fontSize(size * 0.34).fillColor(hex(s.accentColor, '#1f2937'))
      .text(initials, x, y + size / 2 - size * 0.22, { width: size, align: 'center' });
    doc.restore();
  }

  private drawPhotoBox(c: Ctx, x: number, y: number, size: number): void {
    const { doc, s, fonts } = c;
    doc.save().lineWidth(0.8).strokeColor(hex(s.tableBorderColor, '#cbd5e1'));
    if (s.studentPhotoShape === 'circle') doc.circle(x + size / 2, y + size / 2, size / 2).stroke();
    else if (s.studentPhotoShape === 'rounded') doc.roundedRect(x, y, size, size, 5).stroke();
    else doc.rect(x, y, size, size).stroke();
    doc.font(fonts.regular).fontSize(6.5).fillColor(hex(s.labelColor, '#64748b'))
      .text('PHOTO', x, y + size / 2 - 4, { width: size, align: 'center' });
    doc.restore();
  }

  // ── Student biodata ────────────────────────────────────────────────────

  private drawStudentInfo(c: Ctx): void {
    const { doc, s, fonts, left, width } = c;
    const rows = this.studentValues(c);
    if (rows.length === 0) return;

    this.ensureSpace(c, 40);
    if (s.showStudentInfoTitle) this.sectionTitle(c, String(s.studentInfoTitle || 'STUDENT DETAILS'));

    const cols = clamp(Math.round(num(s.studentInfoColumns, 3)), 1, 4);
    const colW = width / cols;
    const fs = num(s.baseFontSize, 9.5);
    const rowH = fs * num(s.lineHeight, 1.25) + (s.studentInfoStyle === 'grid' ? 3 : 7);
    const start = doc.y;
    const style = String(s.studentInfoStyle || 'grid');

    rows.forEach((r, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = left + col * colW;
      const y = start + row * rowH;

      if (style === 'boxed' || style === 'table') {
        doc.save().lineWidth(0.5).strokeColor(hex(s.tableBorderColor, '#cbd5e1'))
          .rect(x, y, colW, rowH).stroke().restore();
      }
      const pad = style === 'grid' ? 0 : 4;
      doc.font(fonts.bold).fontSize(fs - 1).fillColor(hex(s.labelColor, '#64748b'));
      const labelText = `${cased(r.label, s.headingCase)}: `;
      const labelW = doc.widthOfString(labelText);
      doc.text(labelText, x + pad, y + (rowH - fs) / 2, { lineBreak: false });
      doc.font(fonts.regular).fontSize(fs).fillColor(hex(s.valueColor, '#0f172a'))
        .text(r.value, x + pad + labelW, y + (rowH - fs) / 2, { width: tw(colW - labelW - pad * 2), lineBreak: false, ellipsis: true });
    });

    doc.y = start + Math.ceil(rows.length / cols) * rowH;

    if (s.showStudentPhoto && s.studentPhotoPosition === 'beside-name') {
      const size = num(s.studentPhotoSize, 72);
      this.drawPhotoBox(c, c.right - size, start, size);
      doc.y = Math.max(doc.y, start + size);
    }
    doc.moveDown(0.4 * c.gap);
  }

  /** Resolve the enabled biodata fields, in the configured order, to values. */
  private studentValues(c: Ctx): Array<{ label: string; value: string }> {
    const { s, m } = c;
    const items = itemsOf(c.s.studentFields);
    const values: Record<string, string | null | undefined> = {
      name: m.student.name,
      admissionNo: m.student.admissionNo,
      gender: titleCase(m.student.gender),
      class: m.student.className,
      stream: m.student.stream,
      term: m.term.name,
      academicYear: m.term.academicYear,
      termStart: fmtDate(m.term.startDate),
      termEnd: fmtDate(m.term.endDate),
      dateOfBirth: fmtDate(m.student.dateOfBirth),
      age: ageOf(m.student.dateOfBirth),
      house: m.student.house,
      dormitory: null,
      lin: null,
      classRank: m.stats.rank != null ? String(m.stats.rank) : null,
      classSize: m.stats.classSize != null ? String(m.stats.classSize) : null,
      meanScore: m.stats.meanPercent != null ? `${Number(m.stats.meanPercent).toFixed(1)}%` : null,
      aggregate: m.stats.aggregate,
      division: m.stats.division,
      feesBalance: null,
    };
    const blank = String(s.emptyCellPlaceholder || '—');
    return items
      .filter((i) => i.enabled)
      .map((i) => ({ label: i.label, value: values[i.key] ? String(values[i.key]) : blank }));
  }

  // ── Marks table ────────────────────────────────────────────────────────

  private drawMarksTable(c: Ctx): void {
    const { doc, s, fonts, m, left, width } = c;
    const examTypes = distinctExamTypes(m.layout.sections);
    const cols = this.resolveTableColumns(c, examTypes);
    if (cols.length === 0) return;

    const fs = num(s.tableFontSize, 8);
    const rowH = num(s.tableRowHeight, 14);
    const style = String(s.tableStyle || 'grid');
    const blank = String(s.emptyCellPlaceholder || '—');
    const maxRows = Math.round(num(s.maxSubjectsPerPage, 22));

    const drawHeaderRow = () => {
      const y = doc.y;
      if (style !== 'minimal') doc.rect(left, y, width, rowH).fill(hex(s.tableHeaderBg, '#1f2937'));
      doc.font(fonts.bold).fontSize(fs).fillColor(style === 'minimal' ? hex(s.sectionTitleColor, '#0f172a') : hex(s.tableHeaderText, '#ffffff'));
      cols.forEach((col) => {
        doc.text(cased(col.label, s.headingCase), left + col.x + 3, y + (rowH - fs) / 2, {
          width: tw(col.w - 6), align: col.align, lineBreak: false, ellipsis: true,
        });
      });
      if (style === 'minimal') {
        doc.save().lineWidth(1).strokeColor(hex(s.accentColor, '#1f2937'))
          .moveTo(left, y + rowH).lineTo(c.right, y + rowH).stroke().restore();
      }
      doc.y = y + rowH;
    };

    let printed = 0;
    for (const section of m.layout.sections) {
      if (!section.subjects?.length) continue;

      this.ensureSpace(c, rowH * 3);
      if (s.showSectionTitles && m.layout.sections.length > 1) this.sectionTitle(c, section.title);
      drawHeaderRow();

      section.subjects.forEach((subj: any, idx: number) => {
        if (printed > 0 && printed % maxRows === 0) {
          doc.addPage();
          drawHeaderRow();
        } else if (this.ensureSpace(c, rowH * 2)) {
          drawHeaderRow();
        }
        const y = doc.y;
        if (s.zebraStripes && idx % 2 === 1) {
          doc.rect(left, y, width, rowH).fill(hex(s.tableStripeColor, '#f8fafc'));
        }
        const cells = this.cellsFor(c, subj, cols, examTypes, idx);
        cols.forEach((col, ci) => {
          const isGrade = col.key === 'grade';
          const color = isGrade && s.colorGrades
            ? this.gradeColor(c, subj)
            : hex(s.valueColor, '#0f172a');
          const bold = (col.key === 'subject' && s.boldSubjectNames) || isGrade;
          doc.font(bold ? fonts.bold : fonts.regular).fontSize(fs).fillColor(color);
          doc.text(cells[ci] ?? blank, left + col.x + 3, y + (rowH - fs) / 2, {
            width: tw(col.w - 6), align: col.align, lineBreak: false, ellipsis: true,
          });
        });
        if (style === 'grid') this.gridLines(c, y, rowH, cols);
        else if (style === 'horizontal') {
          doc.save().lineWidth(0.4).strokeColor(hex(s.tableBorderColor, '#cbd5e1'))
            .moveTo(left, y + rowH).lineTo(c.right, y + rowH).stroke().restore();
        }
        doc.y = y + rowH;
        printed += 1;
      });
    }

    if (printed === 0) {
      doc.font(fonts.italic).fontSize(fs).fillColor(hex(s.labelColor, '#64748b'))
        .text('No subjects recorded for this term.', left, doc.y + 4, { width });
      doc.y += fs + 6;
    } else if (s.showTotalsRow) {
      this.drawTotalsRow(c, cols, examTypes, rowH, fs);
    }
    doc.moveDown(0.4 * c.gap);
  }

  private drawTotalsRow(c: Ctx, cols: TableCol[], examTypes: string[], rowH: number, fs: number): void {
    const { doc, s, fonts, m, left, width } = c;
    const all = m.layout.sections.flatMap((sec) => sec.subjects ?? []);
    if (all.length === 0) return;
    this.ensureSpace(c, rowH * 2);

    const y = doc.y;
    doc.rect(left, y, width, rowH).fill(tint(hex(s.tableHeaderBg, '#1f2937'), 0.9));
    const totalPercent = all.reduce((sum: number, x: any) => sum + Number(x.totalPercent ?? 0), 0);
    const totalPoints = all.reduce((sum: number, x: any) => sum + Number(x.finalPoints ?? 0), 0);
    const mean = all.length ? totalPercent / all.length : 0;

    doc.font(fonts.bold).fontSize(fs).fillColor(hex(s.valueColor, '#0f172a'));
    cols.forEach((col) => {
      let text = '';
      if (col.key === 'subject') text = cased(`Total · ${all.length} subjects`, s.headingCase);
      else if (col.key === 'percent') text = `${mean.toFixed(1)}%`;
      else if (col.key === 'points') text = String(totalPoints);
      else if (col.key === 'total') text = String(Math.round(totalPercent));
      if (!text) return;
      doc.text(text, left + col.x + 3, y + (rowH - fs) / 2, { width: tw(col.w - 6), align: col.align, lineBreak: false, ellipsis: true });
    });
    if (s.tableStyle === 'grid') this.gridLines(c, y, rowH, cols);
    doc.y = y + rowH;
  }

  private gridLines(c: Ctx, y: number, h: number, cols: TableCol[]): void {
    const { doc, s, left } = c;
    doc.save().lineWidth(0.4).strokeColor(hex(s.tableBorderColor, '#cbd5e1'));
    doc.rect(left, y, c.width, h).stroke();
    for (const col of cols.slice(1)) {
      doc.moveTo(left + col.x, y).lineTo(left + col.x, y + h).stroke();
    }
    doc.restore();
  }

  /** Enabled table columns, in order, with `scores` expanded per exam type. */
  private resolveTableColumns(c: Ctx, examTypes: string[]): TableCol[] {
    const { s, width } = c;
    const items = itemsOf(s.tableColumns).filter((i) => i.enabled);
    type Spec = { key: string; label: string; align: 'left' | 'center' | 'right'; weight: number };
    const specs: Spec[] = [];

    for (const item of items) {
      if (item.key === 'scores') {
        // One numeric column per assessment recorded this term.
        for (const t of examTypes) specs.push({ key: `score:${t}`, label: t, align: 'center', weight: 1 });
        if (examTypes.length === 0) specs.push({ key: 'score:none', label: item.label, align: 'center', weight: 1 });
      } else if (item.key === 'subject') {
        specs.push({ key: 'subject', label: item.label, align: 'left', weight: num(s.subjectColumnWidth, 28) / 100 * -1 });
      } else if (item.key === 'remark') {
        specs.push({ key: 'remark', label: item.label, align: 'left', weight: num(s.remarkColumnWidth, 20) / 100 * -1 });
      } else if (item.key === 'serial') {
        specs.push({ key: 'serial', label: item.label, align: 'center', weight: 0.4 });
      } else {
        specs.push({ key: item.key, label: item.label, align: 'center', weight: 1 });
      }
    }
    if (specs.length === 0) return [];

    // Negative weights are explicit percentages of the content width; the rest
    // share whatever is left over.
    const fixed = specs.filter((x) => x.weight < 0);
    const flex = specs.filter((x) => x.weight >= 0);
    const fixedTotal = fixed.reduce((sum, x) => sum + -x.weight, 0);
    const flexShare = Math.max(0, 1 - fixedTotal);
    const flexWeight = flex.reduce((sum, x) => sum + x.weight, 0) || 1;

    let x = 0;
    return specs.map((spec) => {
      const frac = spec.weight < 0 ? -spec.weight : (spec.weight / flexWeight) * flexShare;
      const col: TableCol = { key: spec.key, label: spec.label, align: spec.align, x, w: width * frac };
      x += col.w;
      return col;
    });
  }

  private cellsFor(c: Ctx, subj: any, cols: TableCol[], examTypes: string[], idx: number): string[] {
    const { s } = c;
    const blank = String(s.emptyCellPlaceholder || '—');
    const scores: any[] = subj.examScores ?? [];
    const totalMarks = scores.reduce((sum, x) => sum + Number(x.marks ?? 0), 0);
    const totalMax = scores.reduce((sum, x) => sum + Number(x.maxMarks ?? 0), 0);

    return cols.map((col) => {
      if (col.key.startsWith('score:')) {
        const type = col.key.slice(6);
        const hit = scores.find((x) => x.examType === type);
        return hit ? String(hit.marks) : blank;
      }
      switch (col.key) {
        case 'serial': return String(idx + 1);
        case 'subject': return String(subj.subject ?? blank);
        case 'code': return String(subj.subjectCode ?? blank);
        case 'outOf': return totalMax > 0 ? String(totalMax) : blank;
        case 'total': return totalMarks > 0 ? String(totalMarks) : blank;
        case 'percent': return subj.totalPercent != null ? `${subj.totalPercent}%` : blank;
        case 'grade': return String(subj.finalGrade ?? blank);
        case 'points': return subj.finalPoints != null ? String(subj.finalPoints) : blank;
        case 'position': return subj.position != null ? String(subj.position) : blank;
        case 'remark': return String(subj.remark ?? blank);
        case 'initials': return String(subj.teacherInitials ?? blank);
        default: return blank;
      }
    });
  }

  private gradeColor(c: Ctx, subj: any): string {
    const { s } = c;
    const pct = Number(subj.totalPercent ?? 0);
    if (pct >= num(s.gradePassMin, 70)) return hex(s.gradePassColor, '#15803d');
    if (pct < num(s.gradeFailBelow, 40)) return hex(s.gradeFailColor, '#b91c1c');
    return hex(s.gradeWarnColor, '#b45309');
  }

  // ── Optional body blocks ───────────────────────────────────────────────

  private drawSummary(c: Ctx): void {
    const { doc, s, fonts, m, left, width } = c;
    const stats: Array<{ label: string; value: string }> = [...(m.layout.summary ?? [])];
    if (m.stats.meanPercent != null) stats.unshift({ label: 'Mean Score', value: `${Number(m.stats.meanPercent).toFixed(1)}%` });
    if (m.stats.gpa != null) stats.unshift({ label: 'GPA', value: Number(m.stats.gpa).toFixed(2) });
    if (m.stats.rank != null) stats.unshift({ label: 'Position', value: String(m.stats.rank) });
    if (stats.length === 0 && !m.layout.eligible) return;

    this.ensureSpace(c, 60);
    this.sectionTitle(c, 'PERFORMANCE SUMMARY');
    const fs = num(s.baseFontSize, 9.5);
    const style = String(s.summaryStyle || 'cards');

    if (style === 'inline') {
      doc.font(fonts.regular).fontSize(fs).fillColor(hex(s.valueColor, '#0f172a'))
        .text(stats.map((x) => `${x.label}: ${x.value}`).join('     •     '), left, doc.y, { width });
      doc.y += fs + 4;
    } else if (style === 'table') {
      const rowH = fs + 8;
      stats.forEach((x, i) => {
        const y = doc.y;
        doc.save().lineWidth(0.4).strokeColor(hex(s.tableBorderColor, '#cbd5e1')).rect(left, y, width, rowH).stroke().restore();
        doc.moveTo(left + width * 0.4, y).lineTo(left + width * 0.4, y + rowH).stroke();
        doc.font(fonts.bold).fontSize(fs - 0.5).fillColor(hex(s.labelColor, '#64748b'))
          .text(x.label, left + 4, y + 4, { width: tw(width * 0.4 - 8), lineBreak: false });
        doc.font(fonts.regular).fillColor(hex(s.valueColor, '#0f172a'))
          .text(x.value, left + width * 0.4 + 4, y + 4, { width: tw(width * 0.6 - 8), lineBreak: false, ellipsis: true });
        doc.y = y + rowH;
      });
    } else {
      // Stat cards, four per row.
      const perRow = 4;
      const cardW = width / perRow;
      const cardH = fs * 2 + 14;
      const start = doc.y;
      stats.forEach((x, i) => {
        const cx = left + (i % perRow) * cardW;
        const cy = start + Math.floor(i / perRow) * (cardH + 4);
        doc.save().lineWidth(0.5).strokeColor(hex(s.tableBorderColor, '#cbd5e1'))
          .roundedRect(cx + 2, cy, cardW - 4, cardH, 3).stroke().restore();
        doc.font(fonts.regular).fontSize(fs - 2).fillColor(hex(s.labelColor, '#64748b'))
          .text(cased(x.label, s.headingCase), cx + 6, cy + 5, { width: tw(cardW - 12), lineBreak: false, ellipsis: true });
        doc.font(fonts.bold).fontSize(fs + 1).fillColor(hex(s.accentColor, '#1f2937'))
          .text(x.value, cx + 6, cy + 5 + fs, { width: tw(cardW - 12), lineBreak: false, ellipsis: true });
      });
      doc.y = start + Math.ceil(stats.length / perRow) * (cardH + 4);
    }

    if (m.layout.eligible) {
      const ok = m.layout.eligible.qualifies;
      doc.font(fonts.bold).fontSize(fs).fillColor(ok ? hex(s.gradePassColor, '#15803d') : hex(s.gradeFailColor, '#b91c1c'))
        .text(ok ? 'ELIGIBLE' : 'NOT ELIGIBLE', left, doc.y + 3, { width, continued: false });
      doc.font(fonts.regular).fontSize(fs - 1).fillColor(hex(s.valueColor, '#0f172a'))
        .text(m.layout.eligible.reason, left, doc.y, { width });
    }
    doc.moveDown(0.4 * c.gap);
  }

  private drawGradeKey(c: Ctx): void {
    const { doc, s, fonts, m, left, width } = c;
    if (!m.gradeBands?.length) return;
    this.ensureSpace(c, 50);
    this.sectionTitle(c, String(s.gradeKeyTitle || 'GRADING KEY'));

    const perRow = clamp(Math.round(num(s.gradeKeyColumns, 5)), 2, 10);
    const fs = num(s.tableFontSize, 8);
    const cellW = width / perRow;
    const cellH = fs * 2 + 8;
    const start = doc.y;

    m.gradeBands.forEach((b, i) => {
      const cx = left + (i % perRow) * cellW;
      const cy = start + Math.floor(i / perRow) * cellH;
      doc.save().lineWidth(0.4).strokeColor(hex(s.tableBorderColor, '#cbd5e1')).rect(cx, cy, cellW, cellH).stroke().restore();
      doc.font(fonts.bold).fontSize(fs).fillColor(hex(s.accentColor, '#1f2937'))
        .text(`${b.grade}`, cx + 3, cy + 3, { width: tw(cellW - 6), lineBreak: false });
      doc.font(fonts.regular).fontSize(fs - 1).fillColor(hex(s.labelColor, '#64748b'))
        .text(`${b.min}–${b.max}${b.remark ? ` · ${b.remark}` : ''}`, cx + 3, cy + 3 + fs, { width: tw(cellW - 6), lineBreak: false, ellipsis: true });
    });
    doc.y = start + Math.ceil(m.gradeBands.length / perRow) * cellH;
    doc.moveDown(0.4 * c.gap);
  }

  private drawAttendance(c: Ctx): void {
    const { doc, s, fonts, m, left, width } = c;
    const a = m.attendance;
    if (a.total === 0) return;
    this.ensureSpace(c, 40);
    this.sectionTitle(c, String(s.attendanceTitle || 'ATTENDANCE'));

    const rate = a.total ? ((a.present + a.late) / a.total) * 100 : 0;
    const cells = [
      { label: 'Days Recorded', value: String(a.total) },
      { label: 'Present', value: String(a.present) },
      { label: 'Absent', value: String(a.absent) },
      { label: 'Late', value: String(a.late) },
      { label: 'Attendance Rate', value: `${rate.toFixed(1)}%` },
    ];
    const fs = num(s.baseFontSize, 9.5);
    const cellW = width / cells.length;
    const y = doc.y;
    cells.forEach((x, i) => {
      const cx = left + i * cellW;
      doc.save().lineWidth(0.4).strokeColor(hex(s.tableBorderColor, '#cbd5e1')).rect(cx, y, cellW, fs * 2 + 10).stroke().restore();
      doc.font(fonts.regular).fontSize(fs - 2).fillColor(hex(s.labelColor, '#64748b'))
        .text(cased(x.label, s.headingCase), cx + 4, y + 4, { width: tw(cellW - 8), lineBreak: false, ellipsis: true });
      doc.font(fonts.bold).fontSize(fs).fillColor(hex(s.valueColor, '#0f172a'))
        .text(x.value, cx + 4, y + 4 + fs, { width: tw(cellW - 8), lineBreak: false });
    });
    doc.y = y + fs * 2 + 10;
    doc.moveDown(0.4 * c.gap);
  }

  /** Trait × rating grid with empty tick boxes for the class teacher to mark. */
  private drawConduct(c: Ctx): void {
    const { doc, s, fonts, left, width } = c;
    const traits = listOf(s.conductTraits);
    const scale = listOf(s.conductScale);
    if (!traits.length || !scale.length) return;
    this.ensureSpace(c, 60);
    this.sectionTitle(c, String(s.conductTitle || 'CONDUCT & BEHAVIOUR'));

    const fs = num(s.tableFontSize, 8);
    const rowH = fs + 8;
    const labelW = width * 0.34;
    const cellW = (width - labelW) / scale.length;

    let y = doc.y;
    doc.rect(left, y, width, rowH).fill(hex(s.tableHeaderBg, '#1f2937'));
    doc.font(fonts.bold).fontSize(fs).fillColor(hex(s.tableHeaderText, '#ffffff'));
    doc.text('', left + 3, y + 4, { width: tw(labelW - 6), lineBreak: false });
    scale.forEach((label, i) => {
      doc.text(label, left + labelW + i * cellW + 2, y + 4, { width: tw(cellW - 4), align: 'center', lineBreak: false, ellipsis: true });
    });
    y += rowH;

    for (const trait of traits) {
      doc.save().lineWidth(0.4).strokeColor(hex(s.tableBorderColor, '#cbd5e1')).rect(left, y, width, rowH).stroke();
      for (let i = 0; i <= scale.length; i++) {
        const gx = left + labelW + i * cellW;
        if (gx <= c.right) doc.moveTo(gx, y).lineTo(gx, y + rowH).stroke();
      }
      doc.restore();
      doc.font(fonts.regular).fontSize(fs).fillColor(hex(s.valueColor, '#0f172a'))
        .text(trait, left + 4, y + 4, { width: tw(labelW - 8), lineBreak: false, ellipsis: true });
      y += rowH;
    }
    doc.y = y;
    doc.moveDown(0.4 * c.gap);
  }

  private drawCoCurricular(c: Ctx): void {
    const { doc, s, fonts, left, width } = c;
    const items = listOf(s.coCurricularActivities);
    if (!items.length) return;
    this.ensureSpace(c, 50);
    this.sectionTitle(c, String(s.coCurricularTitle || 'CO-CURRICULAR ACTIVITIES'));

    const fs = num(s.tableFontSize, 8);
    const rowH = fs + 10;
    let y = doc.y;
    for (const item of items) {
      doc.save().lineWidth(0.4).strokeColor(hex(s.tableBorderColor, '#cbd5e1')).rect(left, y, width, rowH).stroke();
      doc.moveTo(left + width * 0.34, y).lineTo(left + width * 0.34, y + rowH).stroke().restore();
      doc.font(fonts.regular).fontSize(fs).fillColor(hex(s.valueColor, '#0f172a'))
        .text(item, left + 4, y + 5, { width: tw(width * 0.34 - 8), lineBreak: false, ellipsis: true });
      y += rowH;
    }
    doc.y = y;
    doc.moveDown(0.4 * c.gap);
  }

  private drawFees(c: Ctx): void {
    const { doc, s, fonts, left, width } = c;
    if (!s.showFeesBalance) return;
    this.ensureSpace(c, 34);
    this.sectionTitle(c, String(s.feesTitle || 'FEES STATEMENT'));
    const fs = num(s.baseFontSize, 9.5);
    const rowH = fs + 10;
    const y = doc.y;
    doc.save().lineWidth(0.4).strokeColor(hex(s.tableBorderColor, '#cbd5e1')).rect(left, y, width, rowH).stroke().restore();
    doc.font(fonts.bold).fontSize(fs - 1).fillColor(hex(s.labelColor, '#64748b'))
      .text(cased('Outstanding Balance', s.headingCase), left + 4, y + 5, { width: tw(width * 0.5), lineBreak: false });
    doc.font(fonts.regular).fillColor(hex(s.valueColor, '#0f172a'))
      .text('__________________', left + width * 0.5, y + 5, { width: tw(width * 0.5 - 8), align: 'right', lineBreak: false });
    doc.y = y + rowH;
    doc.moveDown(0.4 * c.gap);
  }

  private drawComments(c: Ctx): void {
    const { doc, s, m } = c;
    const boxes: Array<{ label: string; text: string | null }> = [];
    if (s.showClassTeacherComment) boxes.push({ label: String(s.classTeacherLabel || "CLASS TEACHER'S COMMENT"), text: m.comments.classTeacher ?? null });
    if (s.showHeadTeacherComment) boxes.push({ label: String(s.headTeacherLabel || "HEAD TEACHER'S COMMENT"), text: m.comments.headTeacher ?? null });
    if (s.showParentComment) boxes.push({ label: String(s.parentCommentLabel || "PARENT'S / GUARDIAN'S COMMENT"), text: null });
    if (m.comments.competency) boxes.push({ label: 'COMPETENCY LEVELS', text: m.comments.competency });
    if (boxes.length === 0) return;

    for (const box of boxes) this.drawCommentBox(c, box.label, box.text);
    doc.moveDown(0.2 * c.gap);
  }

  private drawCommentBox(c: Ctx, label: string, text: string | null): void {
    const { doc, s, fonts, left, width } = c;
    const fs = num(s.baseFontSize, 9.5);
    const lines = clamp(Math.round(num(s.commentLines, 2)), 0, 6);
    const style = String(s.commentBoxStyle || 'boxed');
    const bodyH = text
      ? Math.max(fs * num(s.lineHeight, 1.25), doc.font(fonts.regular).fontSize(fs).heightOfString(text, { width: tw(width - 12) }))
      : lines * (fs * num(s.lineHeight, 1.25) + 3);
    const boxH = fs + 6 + bodyH + 8;

    this.ensureSpace(c, boxH + 8);
    const y = doc.y;

    if (style === 'boxed') {
      doc.save().lineWidth(0.5).strokeColor(hex(s.tableBorderColor, '#cbd5e1')).roundedRect(left, y, width, boxH, 3).stroke().restore();
    }
    doc.font(fonts.bold).fontSize(fs - 1.5).fillColor(hex(s.labelColor, '#64748b'))
      .text(cased(label, s.headingCase), left + 6, y + 4, { width: tw(width - 12), characterSpacing: num(s.letterSpacing, 0.4) });

    const bodyY = y + fs + 5;
    if (text) {
      doc.font(fonts.regular).fontSize(fs).fillColor(hex(s.valueColor, '#0f172a'))
        .text(text, left + 6, bodyY, { width: tw(width - 12) });
    } else if (lines > 0) {
      // Ruled lines for a teacher to complete by hand.
      doc.save().lineWidth(0.4).strokeColor(hex(s.tableBorderColor, '#cbd5e1'));
      for (let i = 0; i < lines; i++) {
        const ly = bodyY + (i + 1) * (fs * num(s.lineHeight, 1.25) + 3);
        doc.moveTo(left + 6, ly).lineTo(c.right - 6, ly).stroke();
      }
      doc.restore();
    }
    if (style === 'lined') {
      doc.save().lineWidth(0.6).strokeColor(hex(s.accentColor, '#1f2937'))
        .moveTo(left, y + boxH).lineTo(c.right, y + boxH).stroke().restore();
    }
    doc.y = y + boxH + 4;
  }

  private drawNextTerm(c: Ctx): void {
    const { doc, s, fonts, left, width } = c;
    const note = String(s.nextTermNote || '').trim();
    this.ensureSpace(c, 34);
    this.sectionTitle(c, String(s.nextTermTitle || 'NEXT TERM'));
    const fs = num(s.baseFontSize, 9.5);
    doc.font(fonts.regular).fontSize(fs).fillColor(hex(s.valueColor, '#0f172a'))
      .text('Next term begins: ______________________', left, doc.y, { width });
    if (note) {
      doc.font(fonts.italic).fontSize(fs - 1).fillColor(hex(s.labelColor, '#64748b'))
        .text(note, left, doc.y + 2, { width });
    }
    doc.moveDown(0.4 * c.gap);
  }

  private drawSignatures(c: Ctx): void {
    const { doc, s, fonts, left, width } = c;
    const labels = s.showSignatureLines ? listOf(s.signatureLabels) : [];
    if (labels.length === 0 && !s.showSchoolStamp) return;

    const fs = num(s.baseFontSize, 9.5);
    const stampW = s.showSchoolStamp ? Math.min(110, width * 0.24) : 0;
    const stampH = 52;
    const blockH = Math.max(stampH, 30);
    this.ensureSpace(c, blockH + 12);

    const y = doc.y + 6;
    const sigArea = width - (stampW ? stampW + 12 : 0);
    const perSig = labels.length ? sigArea / labels.length : 0;

    labels.forEach((label, i) => {
      const sx = left + i * perSig;
      const lineY = y + blockH - 14;
      doc.save().lineWidth(0.6).strokeColor(hex(s.accentColor, '#1f2937'))
        .moveTo(sx, lineY).lineTo(sx + perSig - 14, lineY).stroke().restore();
      doc.font(fonts.regular).fontSize(fs - 1.5).fillColor(hex(s.labelColor, '#64748b'))
        .text(label, sx, lineY + 3, { width: tw(perSig - 14), lineBreak: false, ellipsis: true });
    });

    if (s.showSchoolStamp) {
      const sx = c.right - stampW;
      doc.save().lineWidth(0.6).dash(3, { space: 2 }).strokeColor(hex(s.tableBorderColor, '#cbd5e1'))
        .roundedRect(sx, y, stampW, stampH, 4).stroke().undash().restore();
      doc.font(fonts.regular).fontSize(fs - 2).fillColor(hex(s.labelColor, '#64748b'))
        .text(String(s.stampLabel || 'School Stamp'), sx, y + stampH / 2 - 4, { width: tw(stampW), align: 'center', lineBreak: false });
    }
    doc.y = y + blockH + 8;
  }

  // ── Page furniture ─────────────────────────────────────────────────────

  /**
   * Frame, footer and page numbers, applied to every buffered page once the
   * total page count is known.
   */
  private decoratePages(c: Ctx): void {
    const { doc, s, fonts, m, left, width } = c;
    const range = doc.bufferedPageRange();
    const fs = num(s.footerFontSize, 7);
    const footerColor = hex(s.footerColor, '#64748b');

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);

      // Page frame.
      const border = String(s.pageBorder || 'thin');
      if (border !== 'none') {
        const inset = 6;
        const w = doc.page.width - inset * 2;
        const h = doc.page.height - inset * 2;
        doc.save().strokeColor(hex(s.pageBorderColor, '#1f2937'));
        doc.lineWidth(border === 'thick' ? 2.2 : border === 'double' ? 1.4 : 0.8);
        doc.rect(inset, inset, w, h).stroke();
        if (border === 'double') {
          doc.lineWidth(0.5).rect(inset + 3.5, inset + 3.5, w - 7, h - 7).stroke();
        }
        doc.restore();
      }

      // Footer band.
      const lines: string[] = [...listOf(s.footerLines)];
      if (s.showDisclaimer && s.disclaimerText) lines.push(String(s.disclaimerText));

      const meta: string[] = [];
      if (s.showGeneratedDate) meta.push(`Generated ${fmtDate(m.generatedAt)}`);
      if (s.showVerificationCode) meta.push(`Verification: ${m.verificationCode}`);
      if (s.showPageNumbers) meta.push(`Page ${i - range.start + 1} of ${range.count}`);
      if (meta.length) lines.push(meta.join('     •     '));

      if (lines.length === 0) continue;
      const blockH = lines.length * (fs + 2);
      let fy = doc.page.height - doc.page.margins.bottom - blockH + 2;
      doc.save().lineWidth(0.4).strokeColor(hex(s.tableBorderColor, '#cbd5e1'))
        .moveTo(left, fy - 4).lineTo(c.right, fy - 4).stroke().restore();
      doc.font(fonts.regular).fontSize(fs).fillColor(footerColor);
      for (const line of lines) {
        doc.text(line, left, fy, { width, align: 'center', lineBreak: false, ellipsis: true });
        fy += fs + 2;
      }
    }
  }

  // ── Small shared primitives ────────────────────────────────────────────

  private sectionTitle(c: Ctx, text: string): void {
    const { doc, s, fonts, left, width } = c;
    const fs = num(s.sectionFontSize, 10);
    doc.font(fonts.bold).fontSize(fs).fillColor(hex(s.sectionTitleColor, '#0f172a'))
      .text(cased(text, s.headingCase), left, doc.y, { width, characterSpacing: num(s.letterSpacing, 0.4) });
    doc.y += 2;
  }

  private rule(c: Ctx): void {
    const { doc, s, left } = c;
    doc.save().lineWidth(0.8).strokeColor(hex(s.accentColor, '#1f2937'))
      .moveTo(left, doc.y).lineTo(c.right, doc.y).stroke().restore();
    doc.y += 4 * c.gap;
  }

  /**
   * Break to a new page when `needed` points will not fit above the footer.
   * Returns true when a break happened, so table callers can reprint headers.
   */
  private ensureSpace(c: Ctx, needed: number): boolean {
    const { doc, s } = c;
    const footerReserve = (listOf(s.footerLines).length + (s.showDisclaimer ? 1 : 0) + 1) * (num(s.footerFontSize, 7) + 2) + 10;
    const limit = doc.page.height - doc.page.margins.bottom - footerReserve;
    if (doc.y + needed <= limit) return false;
    doc.addPage();
    return true;
  }
}

// ── Types & helpers ──────────────────────────────────────────────────────

interface Ctx {
  doc: PDFKit.PDFDocument;
  s: Record<string, any>;
  fonts: { regular: string; bold: string; italic: string; boldItalic: string };
  gap: number;
  left: number;
  right: number;
  width: number;
  m: RenderModel;
}

interface TableCol {
  key: string;
  label: string;
  align: 'left' | 'center' | 'right';
  x: number;
  w: number;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Floor a computed text width at one point.
 *
 * Column widths here are derived by subtraction (cell width minus padding,
 * minus a measured label), and a wide label in a narrow column can drive the
 * remainder negative. pdfkit's line wrapper never terminates on a negative
 * width — with `ellipsis: true` it spins allocating until the heap dies — so
 * every width handed to `doc.text` goes through this.
 */
function tw(n: number): number {
  return Number.isFinite(n) ? Math.max(1, n) : 1;
}

function hex(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : fallback;
}

/** Blend a colour toward white — used for the softer totals-row fill. */
function tint(color: string, amount: number): string {
  const full = color.length === 4
    ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
    : color;
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  const mix = (ch: number) => Math.round(ch + (255 - ch) * amount).toString(16).padStart(2, '0');
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

function cased(text: string, mode: unknown): string {
  if (mode === 'uppercase') return text.toUpperCase();
  if (mode === 'capitalize') return titleCase(text);
  return text;
}

function titleCase(text: string): string {
  return String(text ?? '').replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function fmtDate(d?: Date | string | null): string {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function ageOf(dob?: Date | null): string | null {
  if (!dob) return null;
  const diff = Date.now() - new Date(dob).getTime();
  const years = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  return years > 0 && years < 120 ? `${years}` : null;
}

/**
 * `{term}` / `{year}` / `{school}` / `{student}` / `{class}` placeholders in
 * the report title and subtitle. Exported for unit testing — the rendered PDF
 * content stream is deflated, so the substitution cannot be asserted from the
 * output bytes.
 */
export function interpolate(text: string, m: Pick<RenderModel, 'term' | 'school' | 'student'>): string {
  return text
    .replace(/\{term\}/gi, m.term.name)
    .replace(/\{year\}/gi, m.term.academicYear ?? String(new Date().getFullYear()))
    .replace(/\{school\}/gi, m.school.name)
    .replace(/\{student\}/gi, m.student.name)
    .replace(/\{class\}/gi, m.student.className);
}

function itemsOf(v: unknown): ColumnItem[] {
  return Array.isArray(v) ? (v as ColumnItem[]) : [];
}

function listOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
}

function enabledKeys(v: unknown, fallback: string[]): string[] {
  const items = itemsOf(v).filter((i) => i.enabled).map((i) => i.key);
  return items.length ? items : fallback;
}

function distinctExamTypes(sections: Array<{ subjects: any[] }>): string[] {
  const seen = new Set<string>();
  for (const sec of sections ?? []) {
    for (const subj of sec.subjects ?? []) {
      for (const score of subj.examScores ?? []) {
        if (score?.examType) seen.add(String(score.examType));
      }
    }
  }
  return [...seen];
}

/**
 * Decode an inline `data:` image. Remote URLs are deliberately not fetched —
 * PDF generation must not make outbound network calls, so schools that store a
 * remote logo get the lettered placeholder instead.
 */
function dataUriToBuffer(url?: string): Buffer | null {
  if (!url || !url.startsWith('data:image/')) return null;
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  try {
    return Buffer.from(url.slice(comma + 1), 'base64');
  } catch {
    return null;
  }
}
