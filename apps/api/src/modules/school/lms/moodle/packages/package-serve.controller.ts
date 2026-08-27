import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../../../kernel/auth/decorators/require-permissions.decorator';
import { PackageServeService } from './package-serve.service';

/**
 * Static delivery for SCORM / H5P packages (L8).
 *
 * The wildcard path is what makes a package runnable — its own HTML asks for
 * relative assets — so the service treats every requested path as hostile and
 * confirms it stays inside the archive before reading.
 */
@Controller('school/lms/packages')
export class PackageServeController {
  constructor(private readonly packages: PackageServeService) {}

  /** The launch page a player should open, resolved from imsmanifest.xml. */
  @Get(':kind/:fileId/entry-point')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  async entryPoint(@Param('fileId') fileId: string) {
    return { entryPoint: await this.packages.entryPointOf(fileId) };
  }

  @Get(':kind/:fileId/*path')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  async asset(
    @Param('fileId') fileId: string,
    @Param('path') path: string | string[],
    @Res() res: Response,
  ) {
    const entry = Array.isArray(path) ? path.join('/') : path;
    const { body, contentType } = await this.packages.read(fileId, entry);
    res.setHeader('Content-Type', contentType);
    // Package assets are immutable for the life of the upload, but they are also
    // course material — keep them private to the caller who was authorised.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(body);
  }
}
