/**
 * Extracts the authenticated user's organizationId from the request.
 * Throws when no tenant context is present (protected endpoints only).
 */
import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

interface AuthPayload {
  organizationId?: string;
}

export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const auth = ctx.switchToHttp().getRequest<{ auth?: AuthPayload }>().auth;
    if (!auth?.organizationId) {
      throw new UnauthorizedException('Missing organization context');
    }
    return auth.organizationId;
  },
);