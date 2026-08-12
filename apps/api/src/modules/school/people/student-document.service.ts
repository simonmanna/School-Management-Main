import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import type { CreateStudentDocumentDto } from './dto.types';

@Injectable()
export class StudentDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  async create(dto: CreateStudentDocumentDto) {
    return this.prisma.client.studentDocument.create({
      data: {
        organizationId: this.tenant.organizationId,
        studentProfileId: dto.studentProfileId,
        type: dto.type,
        title: dto.title,
        // P0/B10: references a platform File row instead of a bare URL string.
        fileId: dto.fileId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
  }

  async verify(id: string, verified: boolean) {
    return this.prisma.client.studentDocument.updateMany({
      where: { id },
      data: {
        verified,
        verifiedById: this.tenant.userId ?? null,
        verifiedAt: verified ? new Date() : null,
      },
    });
  }

  async listByStudent(studentProfileId: string) {
    return this.prisma.client.studentDocument.findMany({
      where: { studentProfileId },
      orderBy: { uploadedAt: 'desc' },
    });
  }
}