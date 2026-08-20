import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';

/**
 * Admissions committee (Phase 2). An application can be assigned to several
 * reviewers, each of whom records an independent recommendation and score. This
 * is the separation-of-duties layer: the person who screens is not necessarily
 * the person who decides, and reviewers do not overwrite each other.
 *
 * The old `Interview` model was 1:1 with the application — one interviewer, one
 * rating, no panel. Reviewer assignments generalise that without disturbing the
 * existing Interview row (which stays as the scheduled-interview record).
 */
@Injectable()
export class AdmissionsCommitteeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  /** Assign one or more reviewers to an application. Idempotent per reviewer. */
  async assignReviewers(applicationId: string, reviewerIds: string[], role = 'reviewer') {
    const organizationId = this.tenant.organizationId;
    const app = await this.prisma.client.admissionApplication.findFirst({ where: { id: applicationId } });
    if (!app) throw new NotFoundException(`Application ${applicationId} not found`);

    const created: any[] = [];
    for (const reviewerId of reviewerIds) {
      const row = await this.prisma.client.admissionReviewerAssignment.upsert({
        where: { applicationId_reviewerId: { applicationId, reviewerId } as any },
        create: { organizationId, applicationId, reviewerId, role, assignedById: this.tenant.userId ?? null },
        update: { role },
      });
      created.push(row);
    }
    await this.audit.record({
      entity: 'AdmissionApplication',
      entityId: applicationId,
      action: 'assign',
      newValues: { reviewerIds, role },
    });
    return created;
  }

  /** A reviewer records their independent recommendation + score + comments. */
  async submitReview(assignmentId: string, dto: { recommendation: string; score?: number; comments?: string }) {
    const assignment = await this.prisma.client.admissionReviewerAssignment.findFirst({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException(`Reviewer assignment ${assignmentId} not found`);
    // A reviewer may only submit their OWN assignment. The tenant user id must
    // match the reviewer the work was assigned to — otherwise one reviewer could
    // fill in another's recommendation.
    const currentUser = this.tenant.userId;
    if (currentUser && assignment.reviewerId !== currentUser) {
      throw new BadRequestException('You can only submit your own review assignment');
    }
    if (!['accept', 'reject', 'waitlist', 'borderline'].includes(dto.recommendation)) {
      throw new BadRequestException(`Invalid recommendation '${dto.recommendation}'`);
    }
    const updated = await this.prisma.client.admissionReviewerAssignment.update({
      where: { id: assignmentId },
      data: {
        recommendation: dto.recommendation,
        score: dto.score ?? null,
        comments: dto.comments ?? null,
        status: 'completed',
        completedAt: new Date(),
      },
    });
    await this.audit.record({
      entity: 'AdmissionApplication',
      entityId: assignment.applicationId,
      action: 'update',
      newValues: { reviewer: assignment.reviewerId, recommendation: dto.recommendation, score: dto.score },
    });
    return updated;
  }

  /** Every reviewer's assignment for an application (the committee view). */
  listReviews(applicationId: string) {
    return this.prisma.client.admissionReviewerAssignment.findMany({
      where: { applicationId },
      orderBy: { assignedAt: 'asc' },
    });
  }

  /** A reviewer's own queue: applications assigned to them, filterable by status. */
  myQueue(reviewerId: string, status?: string) {
    return this.prisma.client.admissionReviewerAssignment.findMany({
      where: { reviewerId, ...(status ? { status } : {}) },
      include: { application: true },
      orderBy: { assignedAt: 'desc' },
    });
  }

  /**
   * Aggregate the committee's independent reviews into a recommendation summary:
   * counts per recommendation, average score, and whether a quorum has completed.
   * The final decision is still recorded through AdmissionsService.recordDecision
   * — this only informs it.
   */
  async committeeSummary(applicationId: string, quorum = 1) {
    const reviews = await this.listReviews(applicationId);
    const completed = reviews.filter((r) => r.status === 'completed');
    const tally: Record<string, number> = {};
    let scoreSum = 0;
    let scoreCount = 0;
    for (const r of completed) {
      if (r.recommendation) tally[r.recommendation] = (tally[r.recommendation] ?? 0) + 1;
      if (r.score != null) { scoreSum += r.score; scoreCount++; }
    }
    const leaning = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      applicationId,
      assigned: reviews.length,
      completed: completed.length,
      quorumMet: completed.length >= quorum,
      tally,
      leaning,
      averageScore: scoreCount ? Math.round((scoreSum / scoreCount) * 100) / 100 : null,
    };
  }
}
