import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { LessonPlanningService } from './lesson-planning.service';

/**
 * Printable lesson plans and schemes of work.
 *
 * A Ugandan school is inspected on paper: a head of department signs a plan, an
 * inspector asks for the term's scheme, and both expect a document rather than a
 * screen. The data is all in `LessonPlan` and `SchemeOfWork` already; what was
 * missing was a way to get it onto A4.
 *
 * `pdfkit`, server-side, matching `examinations/report-card-pdf.service.ts` —
 * not the browser-side `jspdf` the list exports use. A plan that goes in an
 * inspection file must render the same whoever prints it, and must not depend on
 * what the operator's browser does with a web font.
 */

const MM = 2.834645669; // 1 mm in PostScript points
const FONT = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const FONT_ITALIC = 'Helvetica-Oblique';

/** Strip the rich-text HTML a plan may carry down to printable plain text. */
function plain(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function dateOnly(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

@Injectable()
export class LessonPlanPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly planning: LessonPlanningService,
  ) {}

  private get org(): string {
    return this.tenant.organizationId;
  }

  /** The school's name and motto for the page header. */
  private async letterhead(): Promise<{ name: string; motto: string | null }> {
    const [org, profile] = await Promise.all([
      this.prisma.client.organization.findFirst({ where: { id: this.org }, select: { name: true } }),
      this.prisma.client.schoolProfile.findFirst({
        where: { organizationId: this.org },
        select: { motto: true },
      }),
    ]);
    return { name: org?.name ?? 'School', motto: (profile as any)?.motto ?? null };
  }

  // ── Lesson plan ─────────────────────────────────────────────────────────

  async lessonPlanPdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    // Goes through the planning service so the plan's own tenancy and shape
    // rules apply, rather than re-querying it loosely here.
    const plan: any = await this.planning.getLessonPlan(id);
    const head = await this.letterhead();

    const teacher = plan.teacher
      ? [plan.teacher.firstName, plan.teacher.lastName].filter(Boolean).join(' ')
      : null;

    const buffer = await this.draw((doc, w) => {
      this.pageHeader(doc, w, head, 'Lesson plan');

      doc.font(FONT_BOLD).fontSize(15).text(plain(plan.title) || 'Lesson plan');
      doc.moveDown(0.4);

      this.facts(doc, w, [
        ['Subject', plan.subject?.name ?? '—'],
        ['Course', plan.courseOffering?.name ?? '—'],
        ['Week of', dateOnly(plan.weekOf)],
        ['Teacher', teacher ?? '—'],
        ['Status', String(plan.workflowStatus ?? 'draft').replace(/_/g, ' ')],
        ['Topic', [plan.subtopic].filter(Boolean).join(' · ') || '—'],
      ]);

      // Objectives: the linked first-class ones, else the free-text summary.
      const linked: string[] = (plan.learningObjectives ?? [])
        .map((lo: any) => plain(lo.learningObjective?.description))
        .filter(Boolean);
      const objectives = linked.length > 0 ? linked : splitLines(plan.objectives);
      this.bullets(doc, w, 'Learning objectives', objectives);

      const outcomes: string[] = (plan.learningOutcomes ?? [])
        .map((lo: any) =>
          [plain(lo.learningOutcome?.title), plain(lo.learningOutcome?.description)]
            .filter(Boolean)
            .join(' — '),
        )
        .filter(Boolean);
      this.bullets(doc, w, 'Learning outcomes', outcomes);

      this.paragraph(doc, w, 'Materials', plain(plan.materials));

      // Activities, in the order they are taught.
      const acts = [...(plan.lessonPlanActivities ?? [])].sort(
        (a: any, b: any) => (a.sequence ?? 0) - (b.sequence ?? 0),
      );
      if (acts.length > 0) {
        this.heading(doc, w, 'Activities');
        acts.forEach((a: any, i: number) => {
          const mins = a.durationMin ? ` · ${a.durationMin} min` : '';
          const name = plain(a.learningActivity?.title) || `Activity ${i + 1}`;
          doc.font(FONT_BOLD).fontSize(10).text(`${i + 1}. ${name}${mins}`, { width: w });
          const t = plain(a.teacherInstructions);
          const s = plain(a.studentInstructions);
          if (t) doc.font(FONT).fontSize(9.5).text(`Teacher: ${t}`, { width: w, indent: 12 });
          if (s) doc.font(FONT).fontSize(9.5).text(`Pupils: ${s}`, { width: w, indent: 12 });
          doc.moveDown(0.3);
        });
      }

      const resources: string[] = (plan.lessonPlanResources ?? [])
        .map((r: any) => {
          const res = r.learningResource;
          if (!res) return '';
          return [plain(res.title), res.url || res.fileUrl].filter(Boolean).join(' — ');
        })
        .filter(Boolean);
      this.bullets(doc, w, 'Resources', resources);

      const assessments: string[] = [...(plan.lessonPlanAssessments ?? [])]
        .sort((a: any, b: any) => (a.sequence ?? 0) - (b.sequence ?? 0))
        .map((a: any) => `${String(a.kind ?? '').replace(/_/g, ' ')}: ${plain(a.prompt)}`);
      this.bullets(doc, w, 'Assessment', assessments);

      const diff: string[] = (plan.lessonPlanDifferentiations ?? []).map(
        (d: any) => `${String(d.tier ?? '').toUpperCase()}: ${plain(d.description)}`,
      );
      this.bullets(doc, w, 'Differentiation', diff);

      // Reflection is written after teaching, so it is usually empty on the copy
      // that goes out for approval. Printed only when there is something in it.
      const refl = (plan.lessonPlanReflections ?? [])[0];
      if (refl) {
        const lines = [
          refl.whatWorked ? `What worked: ${plain(refl.whatWorked)}` : '',
          refl.whatDidnt ? `What did not: ${plain(refl.whatDidnt)}` : '',
          refl.teacherPerceivedAchievement ? `Achievement: ${plain(refl.teacherPerceivedAchievement)}` : '',
          refl.studentsNeedingSupport ? `Needs support: ${plain(refl.studentsNeedingSupport)}` : '',
          refl.followUp ? `Follow-up: ${plain(refl.followUp)}` : '',
        ].filter(Boolean);
        this.bullets(doc, w, 'Reflection', lines);
      }

      this.signatures(doc, w, plan.lessonPlanReviews ?? []);
    });

    const safeTitle = (plain(plan.title) || 'lesson-plan').replace(/[^a-z0-9]+/gi, '-').slice(0, 48);
    return { buffer, filename: `${safeTitle}-${dateOnly(plan.weekOf).replace(/ /g, '')}.pdf` };
  }

  // ── Scheme of work ──────────────────────────────────────────────────────

  async schemeOfWorkPdf(courseOfferingId: string): Promise<{ buffer: Buffer; filename: string }> {
    const scheme: any = await this.prisma.client.schemeOfWork.findFirst({
      where: { organizationId: this.org, courseOfferingId },
      include: {
        weeks: {
          orderBy: { weekNumber: 'asc' },
          include: { items: { orderBy: { order: 'asc' } } },
        },
      },
    });
    if (!scheme) throw new NotFoundException('This course has no scheme of work');

    const offering: any = await this.prisma.client.courseOffering.findFirst({
      where: { id: courseOfferingId, organizationId: this.org },
      include: { subject: { select: { name: true } }, term: { select: { name: true } } },
    });
    const head = await this.letterhead();

    const buffer = await this.draw(
      (doc, w) => {
        this.pageHeader(doc, w, head, 'Scheme of work');

        doc.font(FONT_BOLD).fontSize(15).text(plain(scheme.title) || offering?.name || 'Scheme of work');
        doc.moveDown(0.4);
        this.facts(doc, w, [
          ['Subject', offering?.subject?.name ?? '—'],
          ['Course', offering?.name ?? '—'],
          ['Term', offering?.term?.name ?? '—'],
          ['Weeks', String(scheme.weeks?.length ?? 0)],
        ]);

        for (const week of scheme.weeks ?? []) {
          // Keep a week's heading with at least its first line.
          if (doc.y > doc.page.height - doc.page.margins.bottom - 70) doc.addPage();
          doc.moveDown(0.3);
          doc
            .font(FONT_BOLD)
            .fontSize(11)
            .text(
              `Week ${week.weekNumber}${week.weekStart ? ` — ${dateOnly(week.weekStart)}` : ''}`,
              { width: w },
            );
          if (week.theme) doc.font(FONT_ITALIC).fontSize(9.5).text(plain(week.theme), { width: w });
          if (week.notes) doc.font(FONT).fontSize(9).fillColor('#555').text(plain(week.notes), { width: w });
          doc.fillColor('#000');
          const items = week.items ?? [];
          if (items.length === 0) {
            doc.font(FONT).fontSize(9.5).fillColor('#666').text('Nothing planned.', { width: w, indent: 12 });
            doc.fillColor('#000');
          } else {
            for (const it of items) {
              const periods = it.plannedPeriods ? ` (${it.plannedPeriods} period${it.plannedPeriods === 1 ? '' : 's'})` : '';
              doc.font(FONT).fontSize(9.5).text(`• ${plain(it.title)}${periods}`, { width: w, indent: 12 });
            }
          }
        }
      },
      'landscape',
    );

    const safe = (plain(scheme.title) || offering?.name || 'scheme-of-work')
      .replace(/[^a-z0-9]+/gi, '-')
      .slice(0, 48);
    return { buffer, filename: `${safe}-scheme.pdf` };
  }

  // ── Drawing helpers ─────────────────────────────────────────────────────

  private draw(
    body: (doc: PDFKit.PDFDocument, contentWidth: number) => void,
    layout: 'portrait' | 'landscape' = 'portrait',
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout,
        bufferPages: true,
        margins: { top: 15 * MM, right: 15 * MM, bottom: 15 * MM, left: 15 * MM },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      try {
        body(doc, width);
        this.stampPages(doc);
      } catch (e) {
        reject(e as Error);
        return;
      }
      doc.end();
    });
  }

  /** "Page n of m", once the total is known. */
  private stampPages(doc: PDFKit.PDFDocument) {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc
        .font(FONT)
        .fontSize(8)
        .fillColor('#666')
        .text(
          `Page ${i + 1} of ${range.count}`,
          doc.page.margins.left,
          doc.page.height - doc.page.margins.bottom + 4,
          { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'right' },
        );
      doc.fillColor('#000');
    }
  }

  private pageHeader(
    doc: PDFKit.PDFDocument,
    w: number,
    head: { name: string; motto: string | null },
    kind: string,
  ) {
    doc.font(FONT_BOLD).fontSize(12).text(head.name, { width: w, align: 'center' });
    if (head.motto) {
      doc.font(FONT_ITALIC).fontSize(8.5).fillColor('#555').text(head.motto, { width: w, align: 'center' });
      doc.fillColor('#000');
    }
    doc.font(FONT).fontSize(9).fillColor('#555').text(kind.toUpperCase(), { width: w, align: 'center' });
    doc.fillColor('#000');
    doc.moveDown(0.5);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + w, doc.y)
      .strokeColor('#999')
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.6);
  }

  /** Two-column label/value block. */
  private facts(doc: PDFKit.PDFDocument, w: number, rows: Array<[string, string]>) {
    const colW = w / 2;
    const lineH = 13;
    let y = doc.y;
    rows.forEach(([label, value], i) => {
      const x = doc.page.margins.left + (i % 2) * colW;
      if (i % 2 === 0 && i > 0) y += lineH;
      doc.font(FONT_BOLD).fontSize(9).text(`${label}: `, x, y, { continued: true, width: colW - 6 });
      doc.font(FONT).fontSize(9).text(value || '—', { width: colW - 6 });
    });
    doc.x = doc.page.margins.left;
    doc.y = y + lineH + 6;
  }

  private heading(doc: PDFKit.PDFDocument, w: number, title: string) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 50) doc.addPage();
    doc.moveDown(0.3);
    doc.font(FONT_BOLD).fontSize(10.5).text(title.toUpperCase(), doc.page.margins.left, doc.y, { width: w });
    doc.moveDown(0.2);
  }

  private bullets(doc: PDFKit.PDFDocument, w: number, title: string, lines: string[]) {
    const clean = lines.map((l) => plain(l)).filter(Boolean);
    if (clean.length === 0) return;
    this.heading(doc, w, title);
    for (const line of clean) {
      doc.font(FONT).fontSize(9.5).text(`• ${line}`, { width: w, indent: 6 });
    }
  }

  private paragraph(doc: PDFKit.PDFDocument, w: number, title: string, text: string) {
    if (!text) return;
    this.heading(doc, w, title);
    doc.font(FONT).fontSize(9.5).text(text, { width: w });
  }

  /**
   * Signature lines.
   *
   * A plan that has been reviewed prints who reviewed it; one that has not gets
   * blank rules, because the paper copy is what gets signed in the file.
   */
  private signatures(doc: PDFKit.PDFDocument, w: number, reviews: any[]) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 90) doc.addPage();
    doc.moveDown(1);
    const latest = reviews.length > 0 ? reviews[reviews.length - 1] : null;
    if (latest) {
      this.bullets(doc, w, 'Review', [
        `${String(latest.fromStatus ?? '?')} → ${String(latest.toStatus ?? '?')} on ${dateOnly(
          latest.createdAt,
        )}${latest.comment ? ` — ${plain(latest.comment)}` : ''}`,
        latest.requestedChanges ? `Changes asked for: ${plain(latest.requestedChanges)}` : '',
      ]);
    }
    doc.moveDown(1.2);
    const colW = w / 2 - 10;
    const y = doc.y;
    for (const [i, label] of ['Teacher', 'Head of department'].entries()) {
      const x = doc.page.margins.left + i * (colW + 20);
      doc.moveTo(x, y).lineTo(x + colW, y).strokeColor('#333').lineWidth(0.5).stroke();
      doc.font(FONT).fontSize(8.5).fillColor('#555').text(label, x, y + 3, { width: colW });
    }
    doc.fillColor('#000');
  }
}

/** Free-text objectives are often one per line; keep that shape in print. */
function splitLines(value: unknown): string[] {
  const text = plain(value);
  if (!text) return [];
  return text
    .split('\n')
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);
}
