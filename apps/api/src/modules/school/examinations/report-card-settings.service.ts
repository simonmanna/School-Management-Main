import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

export interface ReportCardSettingsDto {
  showSchoolLogo?: boolean;
  showStudentPhoto?: boolean;
  showWatermark?: boolean;
  showClassTeacherComment?: boolean;
  showHeadTeacherComment?: boolean;
  showTermStartDate?: boolean;
  showTermEndDate?: boolean;
  showFeesBalance?: boolean;
  showSchoolMotto?: boolean;
  schoolNameColor?: string;
  schoolAddressColor?: string;
  contactColor?: string;
  websiteColor?: string;
  emailColor?: string;
  reportTitleColor?: string;
}

const DEFAULTS: Required<ReportCardSettingsDto> = {
  showSchoolLogo: true,
  showStudentPhoto: true,
  showWatermark: false,
  showClassTeacherComment: true,
  showHeadTeacherComment: true,
  showTermStartDate: false,
  showTermEndDate: true,
  showFeesBalance: false,
  showSchoolMotto: true,
  schoolNameColor: '#000000',
  schoolAddressColor: '#000000',
  contactColor: '#000000',
  websiteColor: '#000000',
  emailColor: '#000000',
  reportTitleColor: '#000000',
};

const COLUMNS = [
  '"id"',
  '"organizationId"',
  '"showSchoolLogo"',
  '"showStudentPhoto"',
  '"showWatermark"',
  '"showClassTeacherComment"',
  '"showHeadTeacherComment"',
  '"showTermStartDate"',
  '"showTermEndDate"',
  '"showFeesBalance"',
  '"showSchoolMotto"',
  '"schoolNameColor"',
  '"schoolAddressColor"',
  '"contactColor"',
  '"websiteColor"',
  '"emailColor"',
  '"reportTitleColor"',
  '"createdAt"',
  '"updatedAt"',
];

function rowToSettings(row: Record<string, unknown>) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    showSchoolLogo: Boolean(row.showSchoolLogo),
    showStudentPhoto: Boolean(row.showStudentPhoto),
    showWatermark: Boolean(row.showWatermark),
    showClassTeacherComment: Boolean(row.showClassTeacherComment),
    showHeadTeacherComment: Boolean(row.showHeadTeacherComment),
    showTermStartDate: Boolean(row.showTermStartDate),
    showTermEndDate: Boolean(row.showTermEndDate),
    showFeesBalance: Boolean(row.showFeesBalance),
    showSchoolMotto: Boolean(row.showSchoolMotto),
    schoolNameColor: String(row.schoolNameColor),
    schoolAddressColor: String(row.schoolAddressColor),
    contactColor: String(row.contactColor),
    websiteColor: String(row.websiteColor),
    emailColor: String(row.emailColor),
    reportTitleColor: String(row.reportTitleColor),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class ReportCardSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** GET org settings, creating the org default row on first access. */
  async get(): Promise<Record<string, unknown>> {
    const organizationId = this.tenant.organizationId;
    const rows = await this.prisma.raw.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${COLUMNS.join(', ')} FROM "ReportCardSettings" WHERE "organizationId" = $1 LIMIT 1`,
      organizationId,
    );
    if (rows.length) return rowToSettings(rows[0]);
    const created = await this.prisma.raw.$queryRawUnsafe<Record<string, unknown>[]>(
      `INSERT INTO "ReportCardSettings" ("id","organizationId","updatedAt") VALUES (gen_random_uuid(), $1, now()) RETURNING ${COLUMNS.join(', ')}`,
      organizationId,
    );
    return rowToSettings(created[0]);
  }

  /** PATCH org settings (only the provided fields). */
  async update(dto: ReportCardSettingsDto): Promise<Record<string, unknown>> {
    const organizationId = this.tenant.organizationId;
    const patch = { ...DEFAULTS, ...dto };
    await this.prisma.raw.$queryRawUnsafe(
      `INSERT INTO "ReportCardSettings" ("id","organizationId",${Object.keys(patch).map((_, i) => `"${snake(i)}"`).join(',')},"updatedAt")
       VALUES (gen_random_uuid(), $1, ${Object.keys(patch).map((_, i) => `$${i + 2}`).join(',')}, now())
       ON CONFLICT ("organizationId") DO UPDATE SET
         ${Object.keys(patch).map((k, i) => `"${k}" = EXCLUDED."${k}"`).join(', ')},
         "updatedAt" = now()`,
      organizationId,
      ...Object.values(patch),
    );
    return this.get();
  }
}

function snake(i: number): string {
  return [
    'showSchoolLogo',
    'showStudentPhoto',
    'showWatermark',
    'showClassTeacherComment',
    'showHeadTeacherComment',
    'showTermStartDate',
    'showTermEndDate',
    'showFeesBalance',
    'showSchoolMotto',
    'schoolNameColor',
    'schoolAddressColor',
    'contactColor',
    'websiteColor',
    'emailColor',
    'reportTitleColor',
  ][i];
}
