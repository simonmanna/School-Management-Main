import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../jwt-token.service';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<{ auth?: AuthUser }>();
    return request.auth;
  },
);
