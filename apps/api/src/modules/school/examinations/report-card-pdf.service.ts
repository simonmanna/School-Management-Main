import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { ReportCardTemplateService } from './report-card-template.service';

/**
 * ReportCardPdfService — generates a one-page A4 PDF for a student's report card.
 *
 * Pure server-side rendering using pdfkit (no external HTML→PDF service
 * required). The payload from ReportCard.generate includes the templated
 * layout (`sections`, `summary`, `eligible`, `footer`, `columnHeaders`) —
 * we render that into a Uganda-appropriate one-page A4 layout.
 *
 * Layout adapts to the school's grading system (UCE / UACE / CBC / generic)
 * via the `system` field in the payload. For UCE / UACE, the column widths
 * and labels reflect the exam-paper structure used by UNEB.
 *
 * Used by:
 *   - GET /school/report-cards/:id/pdf  (download)
 */
@Injectable()
export class ReportCardPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly templates: ReportCardTemplateService,
  ) {}

  async generatePdf(reportCardId: string): Promise<Buffer> {
    const card = await this.prisma.client.reportCard.findFirst({
      where: { id: reportCardId },
    });
    if (!card) throw new NotFoundException(`ReportCard ${reportCardId} not found`);

    const profile = await this.prisma.client.studentProfile.findFirst({
      where: { id: card.studentProfileId },
      include: { currentClass: { include: { gradeLevel: true } } },
    });
    const partner = profile
      ? await this.prisma.client.partner.findFirst({ where: { id: profile.partnerId } })
      : null;
    const term = await this.prisma.client.term.findFirst({ where: { id: card.termId } });
    const school = await this.prisma.client.schoolProfile.findFirst({
      where: { organizationId: this.tenant.organizationId },
    });

    // Use the layout stored in the payload; fall back to building it fresh
    // if the payload predates the template upgrade.
    const stored: any = card.payload ?? {};
    let layout: {
      system?: string;
      columnHeaders: string[];
      sections: Array<{ title: string; subjects: any[] }>;
      summary: Array<{ label: string; value: string }>;
      eligible?: { qualifies: boolean; reason: string };
      footer?: string[];
    } | null = stored?.sections
      ? {
          system: stored.system ?? undefined,
          columnHeaders: stored.columnHeaders ?? [],
          sections: stored.sections ?? [],
          summary: stored.summary ?? [],
          eligible: stored.eligible,
          footer: stored.footer,
        }
      : null;
    if (!layout) {
      layout = await this.templates.buildLayout(card.studentProfileId, card.termId);
    }

    return this.render({
      studentName: partner?.name ?? 'Student',
      admissionNo: profile?.admissionNo ?? '—',
      className: profile?.currentClass?.name ?? '—',
      termName: term?.name ?? '—',
      schoolName: school?.name ?? 'School',
      motto: school?.motto ?? undefined,
      system: layout.system ?? 'UCE',
      layout,
      gpa: stored?.gpa,
      rank: stored?.rank,
      meanPercent: stored?.meanPercent,
      generatedAt: card.generatedAt,
    });
  }

  private render(args: {
    studentName: string;
    admissionNo: string;
    className: string;
    termName: string;
    schoolName: string;
    motto?: string;
    system: string;
    layout: {
      system?: string;
      columnHeaders: string[];
      sections: Array<{ title: string; subjects: any[] }>;
      summary: Array<{ label: string; value: string }>;
      eligible?: { qualifies: boolean; reason: string };
      footer?: string[];
    };
    gpa?: number;
    rank?: number;
    meanPercent?: number;
    generatedAt: Date;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Header ─────────────────────────────────────────────────────
      doc.fontSize(18).font('Helvetica-Bold').text(args.schoolName, { align: 'center' });
      if (args.motto) {
        doc.fontSize(9).font('Helvetica-Oblique').fillColor('#666').text(args.motto, { align: 'center' });
      }
      doc.moveDown(0.3);
      doc.fillColor('#000').fontSize(13).font('Helvetica-Bold')
        .text(`School Report — ${args.system}`, { align: 'center' });
      doc.fontSize(8).font('Helvetica').fillColor('#888')
        .text(`Generated ${args.generatedAt.toISOString().slice(0, 10)}`, { align: 'center' });
      doc.moveDown();

      // ── Student header ───────────────────────────────────────────
      doc.fillColor('#000').fontSize(10).font('Helvetica');
      const headerY = doc.y;
      const colA = 40, colB = 280, colC = 420;
      doc.text(`Student: ${args.studentName}`, colA, headerY);
      doc.text(`Adm. No.: ${args.admissionNo}`, colB, headerY);
      doc.text(`Class: ${args.className}`, colA, headerY + 14);
      doc.text(`Term: ${args.termName}`, colB, headerY + 14);
      doc.text(`System: ${args.system}`, colC, headerY + 14);
      doc.y = headerY + 36;
      doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown(0.5);

      // ── Sections ─────────────────────────────────────────────────
      const totalSubjects = args.layout.sections.reduce((s, x) => s + x.subjects.length, 0);
      // Decide column widths based on how many columns the system uses.
      const cols = this.columnWidths(args.layout.columnHeaders.length, args.system);

      for (const section of args.layout.sections) {
        if (section.subjects.length === 0) continue;
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#000')
          .text(section.title);
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#fff');
        // Header row
        const startX = 40;
        const startY = doc.y + 2;
        doc.rect(startX, startY, 515, 14).fill('#1f2937');
        args.layout.columnHeaders.forEach((h, i) => {
          doc.fillColor('#fff').text(h, startX + cols[i].x + 2, startY + 3, {
            width: cols[i].w - 4,
            align: i >= 2 && i < args.layout.columnHeaders.length - 2 ? 'right' : 'left',
          });
        });
        doc.y = startY + 16;
        doc.fillColor('#000').font('Helvetica');

        // Data rows
        section.subjects.forEach((s: any, idx: number) => {
          const rowY = doc.y;
          doc.fillColor(idx % 2 === 0 ? '#f9fafb' : '#ffffff');
          doc.rect(startX, rowY, 515, 13).fill();
          doc.fillColor('#000').fontSize(8);
          const values = this.subjectRow(s, args.layout.columnHeaders.length, args.system);
          values.forEach((v, i) => {
            doc.text(String(v ?? ''), startX + cols[i].x + 2, rowY + 3, {
              width: cols[i].w - 4,
              align: i >= 2 && i < args.layout.columnHeaders.length - 2 ? 'right' : 'left',
            });
          });
          doc.y = rowY + 14;
        });
        doc.moveDown(0.3);
      }

      if (totalSubjects === 0) {
        doc.fontSize(9).fillColor('#666').text('No subjects recorded for this term.');
        doc.moveDown();
      }

      // ── Summary block ────────────────────────────────────────────
      doc.moveDown(0.3);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown(0.3);
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#000').text('Summary');
      doc.moveDown(0.2);
      doc.fontSize(10).font('Helvetica');
      for (const s of args.layout.summary) {
        doc.text(`${s.label.padEnd(28)}  ${s.value}`, { continued: false });
      }

      // Eligibility block (UCE only — explicit pass/fail for the certificate)
      if (args.layout.eligible) {
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(11)
          .fillColor(args.layout.eligible.qualifies ? '#15803d' : '#b91c1c')
          .text(args.layout.eligible.qualifies ? '✓ ELIGIBLE' : '✗ NOT ELIGIBLE');
        doc.font('Helvetica').fontSize(9).fillColor('#000')
          .text(args.layout.eligible.reason);
      }

      // GPA / rank (always shown)
      if (args.gpa != null || args.rank != null) {
        doc.moveDown(0.3);
        doc.fontSize(9).fillColor('#444');
        if (args.gpa != null) doc.text(`GPA: ${args.gpa.toFixed(2)}`);
        if (args.rank != null) doc.text(`Class rank: ${args.rank}`);
        if (args.meanPercent != null) doc.text(`Mean percent: ${args.meanPercent.toFixed(1)}%`);
      }

      // ── Footer ───────────────────────────────────────────────────
      doc.moveDown(0.8);
      doc.fontSize(8).fillColor('#888');
      for (const line of args.layout.footer ?? []) {
        doc.text(line, { align: 'center' });
      }

      doc.end();
    });
  }

  private columnWidths(count: number, system: string): Array<{ x: number; w: number }> {
    // Subject column gets the largest share; numeric columns split the rest.
    const total = 515;
    if (count <= 4) {
      // Subject + Code + Marks + Grade → equal-ish
      const w = Math.floor(total / count);
      return Array.from({ length: count }, (_, i) => ({ x: i * w, w }));
    }
    // Default: subject 30%, code 8%, three numeric 14% each, grade 10%, remark 16%.
    const pct = system === 'UACE' || system === 'UCE'
      ? [0.30, 0.07, 0.11, 0.11, 0.11, 0.10, 0.20]  // 7 cols
      : [0.34, 0.10, 0.14, 0.14, 0.14, 0.14]            // 6 cols
    if (count === pct.length) {
      // Accumulate the running x-offset per column. The fork left `x` at 0 for
      // every column (all columns overlapped at the left margin); the equal-
      // distribution fallback below already accumulates, so this matches it.
      let x = 0;
      return pct.map((p) => {
        const col = { x, w: Math.round(total * p) };
        x += col.w;
        return col;
      });
    }
    // Fallback: equal distribution
    const w = Math.floor(total / count);
    return Array.from({ length: count }, (_, i) => ({ x: i * w, w }));
  }

  private subjectRow(s: any, _count: number, system: string): Array<string | number | null> {
    // UCE / UACE: [Subject, Code, Paper1, Paper2, Paper3, Grade, Points, Remark]
    // CBC:       [Strand, Code, Activity, Project, End-of-Term, Level, Remark]
    // Generic:   [Subject, Code, Marks, Max, Percent, Grade, Remark]
    const scores = (s.examScores ?? []) as Array<{ marks: number; maxMarks: number; grade: string | null; points: number | null; examType: string }>;
    const cols: Array<string | number | null> = [s.subject, s.subjectCode ?? '—'];
    if (system === 'UCE' || system === 'UACE') {
      // Show the first 3 exam scores (or empty if fewer).
      for (let i = 0; i < 3; i++) {
        const x = scores[i];
        cols.push(x ? `${x.marks}` : '—');
      }
      cols.push(s.finalGrade ?? '—');
      cols.push(s.finalPoints != null ? String(s.finalPoints) : '—');
      cols.push(s.remark ?? '—');
    } else if (system === 'CBC') {
      cols.push(scores[0]?.marks != null ? String(scores[0].marks) : '—');
      cols.push(scores[1]?.marks != null ? String(scores[1].marks) : '—');
      cols.push(scores[2]?.marks != null ? String(scores[2].marks) : '—');
      cols.push(s.finalGrade ?? '—');
      cols.push(s.remark ?? '—');
    } else {
      const totalMarks = scores.reduce((s, x) => s + x.marks, 0);
      const totalMax = scores.reduce((s, x) => s + x.maxMarks, 0);
      cols.push(totalMarks > 0 ? String(totalMarks) : '—');
      cols.push(totalMax > 0 ? String(totalMax) : '—');
      cols.push(s.totalPercent > 0 ? `${s.totalPercent}%` : '—');
      cols.push(s.finalGrade ?? '—');
      cols.push(s.remark ?? '—');
    }
    return cols;
  }
}