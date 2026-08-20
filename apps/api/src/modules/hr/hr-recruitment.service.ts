import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const VACANCY_STATUSES = ['draft', 'open', 'closed', 'filled'];
const APPLICANT_STATUSES = ['applied', 'screening', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'];

/**
 * HrRecruitmentService — applicant tracking + hire-into-workforce.
 * Vacancy → Applicant (screen → shortlist → interview → offer → hire).
 * Hiring an applicant creates a real HrEmployee via HrOrgService.createEmployee
 * so recruitment feeds the workforce (single employee record per person).
 */
@Injectable()
export class HrRecruitmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
  ) {}

  private async orgId() {
    return this.tenant.organizationId;
  }

  // ── Vacancies ──────────────────────────────────────────────────────────────

  async listVacancies(query: any = {}) {
    const orgId = await this.orgId();
    const where: any = { organizationId: orgId };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { title: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.hrVacancy.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        include: {
          _count: { select: { applicants: true } },
        },
      }),
      this.prisma.client.hrVacancy.count({ where }),
    ]);
    return { rows, total };
  }

  async createVacancy(dto: any) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    if (!dto.title) throw new BadRequestException('title is required');
    const code = dto.code ?? (await this.seq.next('hr_vacancy', { prefix: 'VAC-', padding: 5 }));
    const existing = await this.prisma.client.hrVacancy.findUnique({
      where: { organizationId_code: { organizationId: orgId, code: String(code).toUpperCase() } },
    });
    if (existing) throw new BadRequestException(`Vacancy code "${code}" already exists`);
    return this.prisma.client.hrVacancy.create({
      data: {
        organizationId: orgId,
        code: String(code).toUpperCase(),
        title: dto.title,
        positionId: dto.positionId ?? null,
        departmentId: dto.departmentId ?? null,
        openings: dto.openings ?? 1,
        salaryRange: dto.salaryRange ?? null,
        hiringManagerId: dto.hiringManagerId ?? null,
        status: dto.status ?? 'open',
        description: dto.description ?? null,
        createdBy: userId,
      },
    });
  }

  async updateVacancy(id: string, dto: any) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrVacancy.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Vacancy not found');
    if (dto.status && !VACANCY_STATUSES.includes(dto.status)) throw new BadRequestException(`Invalid status: ${dto.status}`);
    const data: any = { updatedBy: userId };
    for (const f of ['title', 'positionId', 'departmentId', 'openings', 'salaryRange', 'hiringManagerId', 'status', 'description']) {
      if (dto[f] !== undefined) data[f] = dto[f];
    }
    return this.prisma.client.hrVacancy.update({ where: { id }, data });
  }

  async deleteVacancy(id: string) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrVacancy.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Vacancy not found');
    return this.prisma.client.hrVacancy.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
  }

  // ── Applicants ─────────────────────────────────────────────────────────────

  async listApplicants(query: any = {}) {
    const orgId = await this.orgId();
    const where: any = { organizationId: orgId };
    if (query.vacancyId) where.vacancyId = query.vacancyId;
    if (query.status) where.status = query.status;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrApplicant.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        include: { vacancy: true, interviews: { orderBy: { scheduledAt: 'asc' } } },
      }),
      this.prisma.client.hrApplicant.count({ where }),
    ]);
    return { rows, total };
  }

  async createApplicant(dto: any) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    if (!dto.vacancyId || !dto.firstName) throw new BadRequestException('vacancyId and firstName are required');
    const vacancy = await this.prisma.client.hrVacancy.findFirst({ where: { id: dto.vacancyId, organizationId: orgId } });
    if (!vacancy) throw new NotFoundException('Vacancy not found');
    return this.prisma.client.hrApplicant.create({
      data: {
        organizationId: orgId,
        vacancyId: dto.vacancyId,
        firstName: dto.firstName,
        lastName: dto.lastName ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        cvUrl: dto.cvUrl ?? null,
        documentId: dto.documentId ?? null,
        status: 'applied',
        createdBy: userId,
      },
      include: { vacancy: true },
    });
  }

  async setApplicantStatus(id: string, status: string, notes?: string) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    if (!APPLICANT_STATUSES.includes(status)) throw new BadRequestException(`Invalid status: ${status}`);
    const row = await this.prisma.client.hrApplicant.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Applicant not found');
    return this.prisma.client.hrApplicant.update({
      where: { id },
      data: { status, notes: notes ?? row.notes, updatedBy: userId },
      include: { vacancy: true },
    });
  }

  async deleteApplicant(id: string) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrApplicant.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Applicant not found');
    return this.prisma.client.hrApplicant.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
  }

  // ── Interviews ──────────────────────────────────────────────────────────────

  async addInterview(dto: any) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    if (!dto.applicantId) throw new BadRequestException('applicantId is required');
    const applicant = await this.prisma.client.hrApplicant.findFirst({ where: { id: dto.applicantId, organizationId: orgId } });
    if (!applicant) throw new NotFoundException('Applicant not found');
    return this.prisma.client.hrInterview.create({
      data: {
        organizationId: orgId,
        applicantId: dto.applicantId,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        interviewerId: dto.interviewerId ?? null,
        notes: dto.notes ?? null,
        createdBy: userId,
      },
    });
  }

  async updateInterview(id: string, dto: any) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrInterview.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Interview not found');
    const data: any = { updatedBy: userId };
    if (dto.scheduledAt !== undefined) data.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    if (dto.interviewerId !== undefined) data.interviewerId = dto.interviewerId;
    if (dto.score !== undefined) data.score = dto.score;
    if (dto.notes !== undefined) data.notes = dto.notes;
    return this.prisma.client.hrInterview.update({ where: { id }, data });
  }

  async deleteInterview(id: string) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrInterview.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Interview not found');
    return this.prisma.client.hrInterview.update({ where: { id }, data: { deletedAt: new Date(), createdBy: userId } });
  }

  /**
   * Hire an applicant → create an HrEmployee. Reuses the org pr/employee create
   * shape so the new hire inherits all employee machinery (payroll, leave, etc.).
   */
  async hire(id: string, employeeDto: any = {}) {
    const orgId = await this.orgId();
    const userId = this.tenant.userId;
    const applicant = await this.prisma.client.hrApplicant.findFirst({
      where: { id, organizationId: orgId },
      include: { vacancy: true },
    });
    if (!applicant) throw new NotFoundException('Applicant not found');
    if (applicant.hiredEmployeeId) throw new BadRequestException('Applicant already hired');

    const employeeCode = employeeDto.employeeCode ?? (await this.seq.next('hr_employee', { prefix: 'EMP-', padding: 5 }));
    const created = await this.prisma.client.hrEmployee.create({
      data: {
        organizationId: orgId,
        employeeCode,
        firstName: applicant.firstName,
        lastName: applicant.lastName ?? null,
        email: employeeDto.email ?? applicant.email ?? null,
        phone: employeeDto.phone ?? applicant.phone ?? null,
        gender: employeeDto.gender ?? null,
        dateOfBirth: employeeDto.dateOfBirth ? new Date(employeeDto.dateOfBirth) : null,
        address: employeeDto.address ?? null,
        employmentType: employeeDto.employmentType ?? 'FULL_TIME',
        hireDate: employeeDto.hireDate ? new Date(employeeDto.hireDate) : new Date(),
        departmentId: employeeDto.departmentId ?? applicant.vacancy?.departmentId ?? null,
        positionId: employeeDto.positionId ?? applicant.vacancy?.positionId ?? null,
        baseSalary: employeeDto.baseSalary ?? null,
        payFrequency: employeeDto.payFrequency ?? 'MONTHLY',
        isActive: true,
        createdBy: userId,
      },
    });

    // Default onboarding checklist for the new hire.
    const defaultTasks = ['contract_signed', 'id_verified', 'account_created', 'equipment_issued', 'department_assigned', 'orientation_completed'];
    for (const t of defaultTasks) {
      await this.prisma.client.hrOnboardingTask.create({
        data: { organizationId: orgId, employeeId: created.id, task: t, status: 'pending', createdBy: userId },
      });
    }

    await this.prisma.client.hrApplicant.update({ where: { id }, data: { status: 'hired', hiredEmployeeId: created.id, updatedBy: userId } });
    return created;
  }
}
