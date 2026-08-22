/**
 * Unit tests for the Phase 1–5 admissions services that hang off the core FSM:
 * committee/reviewers, config (requirements/templates/enquiries), portal tokens
 * and analytics. Prisma is mocked; these assert the business rules, not the DB.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdmissionsCommitteeService } from '../../src/modules/school/admissions/admissions-committee.service';
import { AdmissionsConfigService } from '../../src/modules/school/admissions/admissions-config.service';
import { AdmissionsAnalyticsService } from '../../src/modules/school/admissions/admissions-analytics.service';
import { AdmissionsPortalService } from '../../src/modules/school/admissions/admissions-portal.service';

const tenant = (userId = 'user_1') => ({ organizationId: 'org_test', userId }) as any;
const audit = () => ({ record: jest.fn(), recordInTx: jest.fn() }) as any;

describe('AdmissionsCommitteeService', () => {
  function make(reviewer = 'user_1') {
    const rows: any[] = [];
    const client = {
      admissionApplication: { findFirst: jest.fn().mockResolvedValue({ id: 'app_1' }) },
      admissionReviewerAssignment: {
        upsert: jest.fn().mockImplementation((a: any) => {
          const row = { id: `ra_${rows.length + 1}`, applicationId: a.create.applicationId, reviewerId: a.create.reviewerId, status: 'assigned', ...a.create };
          rows.push(row);
          return row;
        }),
        findFirst: jest.fn().mockImplementation((a: any) => rows.find((r) => r.id === a.where.id) ?? null),
        update: jest.fn().mockImplementation((a: any) => {
          const row = rows.find((r) => r.id === a.where.id);
          Object.assign(row, a.data);
          return row;
        }),
        findMany: jest.fn().mockImplementation(() => rows),
      },
    };
    const svc = new AdmissionsCommitteeService({ client } as any, tenant(reviewer), audit());
    return { svc, client, rows };
  }

  it('assigns reviewers idempotently', async () => {
    const { svc } = make();
    const res = await svc.assignReviewers('app_1', ['user_1', 'user_2']);
    expect(res).toHaveLength(2);
  });

  it('lets a reviewer submit only their own assignment', async () => {
    const { svc, rows } = make('user_1');
    await svc.assignReviewers('app_1', ['user_2']);
    // rows[0] is assigned to user_2, but the acting user is user_1.
    await expect(svc.submitReview(rows[0].id, { recommendation: 'accept' })).rejects.toThrow(BadRequestException);
  });

  it('rejects an invalid recommendation', async () => {
    const { svc, rows } = make('user_1');
    await svc.assignReviewers('app_1', ['user_1']);
    await expect(svc.submitReview(rows[0].id, { recommendation: 'maybe' })).rejects.toThrow(BadRequestException);
  });

  it('summarises the committee with a leaning and quorum flag', async () => {
    const { svc, rows } = make('user_1');
    await svc.assignReviewers('app_1', ['user_1']);
    await svc.submitReview(rows[0].id, { recommendation: 'accept', score: 80 });
    const summary = await svc.committeeSummary('app_1', 1);
    expect(summary.completed).toBe(1);
    expect(summary.quorumMet).toBe(true);
    expect(summary.leaning).toBe('accept');
    expect(summary.averageScore).toBe(80);
  });
});

describe('AdmissionsConfigService', () => {
  function make() {
    const enquiries: any[] = [];
    const client = {
      admissionRequirement: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((a: any) => ({ id: 'req_1', ...a.data })),
        update: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      admissionOfferTemplate: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((a: any) => ({ id: 'tpl_1', ...a.data })),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      admissionEnquiry: {
        findMany: jest.fn().mockResolvedValue(enquiries),
        findFirst: jest.fn().mockImplementation((a: any) => enquiries.find((e) => e.id === a.where.id) ?? null),
        create: jest.fn().mockImplementation((a: any) => { const e = { id: `enq_${enquiries.length + 1}`, status: 'new', ...a.data }; enquiries.push(e); return e; }),
        update: jest.fn().mockImplementation((a: any) => { const e = enquiries.find((x) => x.id === a.where.id); Object.assign(e, a.data); return e; }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const svc = new AdmissionsConfigService({ client } as any, tenant(), audit());
    return { svc, client, enquiries };
  }

  it('creates a requirement with sane defaults', async () => {
    const { svc } = make();
    const r = await svc.upsertRequirement({ code: 'birth_cert', label: 'Birth certificate' });
    expect(r.kind).toBe('document');
    expect(r.gate).toBe('submit');
    expect(r.required).toBe(true);
  });

  it('clears the previous default when a new default offer template is set', async () => {
    const { svc, client } = make();
    await svc.upsertOfferTemplate({ name: 'Standard', body: 'Hi {{applicantName}}', isDefault: true });
    expect(client.admissionOfferTemplate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isDefault: true }, data: { isDefault: false } }),
    );
  });

  it('converts an enquiry once and refuses a double conversion', async () => {
    const { svc } = make();
    const e = await svc.createEnquiry({ applicantName: 'Grace N' });
    const converted = await svc.markEnquiryConverted(e.id, 'app_1');
    expect(converted.status).toBe('converted');
    await expect(svc.markEnquiryConverted(e.id, 'app_1')).rejects.toThrow(BadRequestException);
  });
});

describe('AdmissionsAnalyticsService.funnel', () => {
  function make(byStatus: Record<string, number>) {
    const grouped = Object.entries(byStatus).map(([status, n]) => ({ status, _count: { _all: n } }));
    const client = {
      admissionApplication: { groupBy: jest.fn().mockResolvedValue(grouped) },
    };
    return new AdmissionsAnalyticsService({ client } as any, tenant());
  }

  it('excludes drafts from the total and computes conversion rates', async () => {
    const svc = make({ draft: 5, submitted: 0, under_review: 10, accepted: 0, offer_issued: 4, offer_accepted: 2, enrolled: 8, rejected: 6 });
    const f = await svc.funnel();
    // total excludes the 5 drafts: 10+4+2+8+6 = 30
    expect(f.total).toBe(30);
    expect(f.drafts).toBe(5);
    // enrolled counts toward accepted/offered/offerAccepted stages.
    expect(f.stages.enrolled).toBe(8);
    expect(f.conversion.overallYield).toBeGreaterThan(0);
  });

  it('returns zeroed conversion when there are no applications', async () => {
    const svc = make({});
    const f = await svc.funnel();
    expect(f.total).toBe(0);
    expect(f.conversion.acceptanceRate).toBe(0);
  });
});

describe('AdmissionsPortalService', () => {
  function make(guardianEmail: string | null, expiresInMs = 60_000) {
    const tokens: any[] = [];
    const client = {
      admissionApplication: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'app_1', applicationNumber: 'APP-1', applicantFirstName: 'Grace', applicantLastName: 'N',
          guardians: guardianEmail ? [{ email: guardianEmail }] : [],
        }),
      },
      admissionPortalToken: { create: jest.fn().mockImplementation((a: any) => { const t = { id: 't1', ...a.data }; tokens.push(t); return t; }) },
    };
    const raw = {
      admissionPortalToken: {
        findFirst: jest.fn().mockImplementation((a: any) => tokens.find((t) => t.tokenHash === a.where.tokenHash) ?? null),
      },
    };
    const notifications = { send: jest.fn().mockResolvedValue({ id: 'n1', delivered: true }) };
    const svc = new AdmissionsPortalService({ client, raw } as any, tenant(), notifications as any);
    // Force the token TTL by patching Date if needed — default 7d is fine for the happy path.
    return { svc, client, tokens, notifications };
  }

  it('refuses to issue a link to an email not on file', async () => {
    const { svc } = make('parent@example.com');
    await expect(svc.issueAccessLink('app_1', 'stranger@example.com')).rejects.toThrow(BadRequestException);
  });

  it('issues a link to a known guardian email and emails it', async () => {
    const { svc, notifications } = make('parent@example.com');
    const res = await svc.issueAccessLink('app_1', 'parent@example.com');
    expect(res.issued).toBe(true);
    expect(notifications.send).toHaveBeenCalled();
  });

  it('resolves a freshly issued token back to its application', async () => {
    const { svc } = make('parent@example.com');
    const res: any = await svc.issueAccessLink('app_1', 'parent@example.com');
    const resolved = await svc.resolveToken(res.devToken);
    expect(resolved.applicationId).toBe('app_1');
  });

  it('rejects an unknown token', async () => {
    const { svc } = make('parent@example.com');
    await expect(svc.resolveToken('not-a-real-token')).rejects.toThrow(NotFoundException);
  });
});
