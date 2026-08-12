import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

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
