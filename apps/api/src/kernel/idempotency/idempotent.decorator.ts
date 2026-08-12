import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent:enabled';

/**
 * Mark a controller route as idempotency-protected.
 *
 * When the route is hit, the IdempotencyInterceptor reads the
 * `Idempotency-Key` header. If present, retries with the same key + body
 * replay the cached response instead of re-running the handler. If absent,
 * the handler runs normally (idempotency becomes the caller's responsibility).
 *
 * Apply to POST/PUT/PATCH/DELETE on money-mutating endpoints.
 */
export const Idempotent = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IDEMPOTENT_KEY, true);