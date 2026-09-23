import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';

/**
 * Database-enforced rules (unique keys, same-tenant foreign keys, the placement
 * grouping and overlap guards) are client errors, not server faults. Without this
 * mapping every one of them reached the client as a 500, which reads as "the
 * system is broken" rather than "that record conflicts". Messages are kept
 * generic: constraint and table names are for the log, not the screen.
 */
function mapDatabaseError(exception: unknown): { status: number; message: string } | null {
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      case 'P2002':
        return { status: 409, message: 'A record with these details already exists.' };
      case 'P2003':
        return {
          status: 409,
          message: 'This refers to a record that does not exist in your school, or is still referenced by other records.',
        };
      case 'P2025':
        return { status: 404, message: 'Record not found.' };
      case 'P2034':
        return { status: 409, message: 'This record was changed by someone else at the same time. Please try again.' };
    }
  }
  const text = exception instanceof Error ? exception.message : '';
  if (/Cross-tenant reference rejected/.test(text)) {
    return { status: 409, message: 'This refers to a record that does not exist in your school.' };
  }
  if (/EnrollmentPlacement_no_overlap|one_open_per_enrollment/.test(text)) {
    return { status: 409, message: "This learner's placement was changed by someone else. Reload and try again." };
  }
  if (/EnrollmentPlacement .*: (section|class cohort) .* (is not in|does not exist)/.test(text)) {
    return { status: 400, message: 'That section does not belong to the chosen class.' };
  }
  return null;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('GlobalException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ id?: string; url?: string; method?: string }>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(body);
      return;
    }

    const mapped = mapDatabaseError(exception);
    if (mapped) {
      this.logger.warn(
        `Database rule rejected ${request.method} ${request.url} [req: ${request.id ?? '-'}]: ` +
          (exception instanceof Error ? exception.message.split('\n').slice(-3).join(' ') : String(exception)),
      );
      response.status(mapped.status).json({ statusCode: mapped.status, message: mapped.message, requestId: request.id });
      return;
    }

    const detail = exception instanceof Error ? exception.message : String(exception);
    const name = exception instanceof Error ? exception.name : 'Error';
    this.logger.error(
      `Unhandled exception on ${request.method} ${request.url} [req: ${request.id ?? '-'}]: ${name}: ${detail}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    // Outside production, surface the cause so the network tab shows something
    // useful instead of a bare "Internal Server Error".
    //
    // In production the client gets only `requestId` — exception messages carry
    // table names, constraint names, file paths and occasionally row values, and
    // this filter fires on the *unhandled* path where the message was never
    // written with an audience in mind. The full detail is already in the log
    // line above, keyed by the same requestId, so on-site debugging is "search
    // the logs for this id" rather than "read it off the screen".
    //
    // EXPOSE_ERROR_DETAIL=true restores the old behaviour for a LAN deployment
    // with no log access. It is a deliberate, opt-in trade.
    const isProd = process.env.NODE_ENV === 'production';
    const exposeDetail = !isProd || process.env.EXPOSE_ERROR_DETAIL === 'true';
    response.status(500).json({
      message: 'Internal Server Error',
      statusCode: 500,
      requestId: request.id,
      ...(exposeDetail
        ? {
            error: detail,
            name,
            ...(isProd
              ? {}
              : { stack: exception instanceof Error ? exception.stack?.split('\n').slice(0, 12) : undefined }),
          }
        : {}),
    });
  }
}
