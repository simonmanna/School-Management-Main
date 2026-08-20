import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import type { CreateCrewMemberDto, UpdateCrewMemberDto, AddCrewDocumentDto } from './dto.types';

@Injectable()
export class TransportCrewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  async listCrew(role?: string) {
    return this.prisma.client.transportCrewMember.findMany({
      where: { organizationId: this.orgId, ...(role ? { role: role as any } : {}) },
      orderBy: { name: 'asc' },
      include: { documents: true },
    });
  }
  async getCrew(id: string) {
    const row = await this.prisma.client.transportCrewMember.findFirst({
      where: { id, organizationId: this.orgId },
      include: { documents: true },
    });
    if (!row) throw new NotFoundException(`TransportCrewMember ${id} not found`);
    return row;
  }
  async createCrew(dto: CreateCrewMemberDto) {
    return this.prisma.client.transportCrewMember.create({
      data: { organizationId: this.orgId, ...(dto as any) },
    });
  }
  async updateCrew(id: string, dto: UpdateCrewMemberDto) {
    await this.getCrew(id);
    return this.prisma.client.transportCrewMember.update({ where: { id }, data: { ...(dto as any) } });
  }
  async removeCrew(id: string) {
    await this.getCrew(id);
    await this.prisma.client.transportCrewMember.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── Documents / compliance ──
  async listDocuments(crewId: string) {
    await this.getCrew(crewId);
    return this.prisma.client.transportCrewDocument.findMany({
      where: { crewMemberId: crewId },
      orderBy: { documentType: 'asc' },
    });
  }
  async addDocument(crewId: string, dto: AddCrewDocumentDto) {
    await this.getCrew(crewId);
    return this.prisma.client.transportCrewDocument.create({
      data: {
        organizationId: this.orgId,
        crewMemberId: crewId,
        documentType: dto.documentType,
        documentNumber: dto.documentNumber,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        fileId: dto.fileId ?? null,
      },
    });
  }
  async removeCrewDocument(crewId: string, docId: string) {
    const doc = await this.prisma.client.transportCrewDocument.findFirst({
      where: { id: docId, crewMemberId: crewId },
    });
    if (!doc) throw new NotFoundException(`TransportCrewDocument ${docId} not found`);
    await this.prisma.client.transportCrewDocument.delete({ where: { id: docId } });
  }

  /** Whether a crew member is dispatch-eligible as of `asOf`. */
  async isDispatchEligible(crewId: string, asOf = new Date()): Promise<{ ok: boolean; reasons: string[] }> {
    const crew = await this.getCrew(crewId);
    const reasons: string[] = [];
    if (crew.status !== 'active') reasons.push(`crew status is ${crew.status}`);
    if (crew.licenseExpiry && new Date(crew.licenseExpiry) < asOf) reasons.push('license expired');
    const mandatory = await this.prisma.client.transportCrewDocument.findMany({
      where: { crewMemberId: crewId, documentType: { in: ['training', 'first_aid', 'background_check'] } },
    });
    for (const m of mandatory) {
      if (!m.expiryDate || new Date(m.expiryDate) < asOf) reasons.push(`${m.documentType} document missing/expired`);
    }
    return { ok: reasons.length === 0, reasons };
  }
}
