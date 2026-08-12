import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthUser } from '../jwt-token.service';

/**
 * Ensures an authenticated user is present (set by the tenant middleware in
 * main.ts) unless the route is marked @Public(). Registered globally.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{ auth?: AuthUser }>();
    if (!request.auth) {
      throw new UnauthorizedException('Authentication required');
    }
    return true;
  }
}
