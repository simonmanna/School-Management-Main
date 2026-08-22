import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { CapabilityService, Principal } from './capability.service';
import { LmsContextService } from './context.service';
import { CapabilitySource, LMS_CAPABILITY_KEY, LMS_CAPABILITY_SOURCE_KEY } from './require-capability.decorator';

/**
 * Enforces the LMS capability declared by @RequireCapability. Resolves the target
 * course context from the request per the declared source, then defers to
 * CapabilityService. Staff principals use tenant.userId; student-portal principals
 * may pass studentProfileId on the request auth.
 */
@Injectable()
export class LmsCapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly caps: CapabilityService,
    private readonly contexts: LmsContextService,
  ) {}

  async canActivate(exec: ExecutionContext): Promise<boolean> {
    const capability = this.reflector.get<string>(LMS_CAPABILITY_KEY, exec.getHandler());
    if (!capability) return true; // route opts out of the fine gate

    const source = this.reflector.get<CapabilitySource>(LMS_CAPABILITY_SOURCE_KEY, exec.getHandler()) ?? 'courseParam';
    const req = exec.switchToHttp().getRequest<{ params?: Record<string, string>; body?: Record<string, unknown>; auth?: { studentProfileId?: string } }>();

    const courseOfferingId = await this.resolveCourse(source, req);
    if (!courseOfferingId) throw new ForbiddenException('Could not resolve course context for capability check');

    const principal: Principal = req.auth?.studentProfileId
      ? { studentProfileId: req.auth.studentProfileId }
      : { userId: this.tenant.userId };

    const ok = await this.caps.canAtCourse(principal, capability, courseOfferingId);
    if (!ok) throw new ForbiddenException(`Missing LMS capability: ${capability}`);
    return true;
  }

  private async resolveCourse(
    source: CapabilitySource,
    req: { params?: Record<string, string>; body?: Record<string, unknown> },
  ): Promise<string | undefined> {
    const id = req.params?.id;
    switch (source) {
      case 'courseParam':
        return id;
      case 'bodyCourse':
        return (req.body?.courseOfferingId as string) ?? undefined;
      case 'moduleParam': {
        if (!id) return undefined;
        const cm = await this.prisma.client.courseModule.findFirst({
          where: { id, organizationId: this.tenant.organizationId },
          select: { courseOfferingId: true },
        });
        return cm?.courseOfferingId;
      }
      case 'sectionParam': {
        if (!id) return undefined;
        const sec = await this.prisma.client.courseSection.findFirst({
          where: { id, organizationId: this.tenant.organizationId },
          select: { courseOfferingId: true },
        });
        return sec?.courseOfferingId;
      }
      default:
        return id;
    }
  }
}
