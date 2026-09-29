import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UPLOAD_OPTIONS } from './upload-limits';
import { ApiTags, ApiBearerAuth, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/jwt-token.service';
import { FilesService } from './files.service';
import type { Request, Response } from 'express';

@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('upload')
  @RequirePermissions('school:documents:write')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        ownerType: { type: 'string' },
        ownerId: { type: 'string' },
      },
      required: ['file'],
    },
  })
  async upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: any,
    @Body('ownerType') ownerType: string | undefined,
    @Body('ownerId') ownerId: string | undefined,
  ) {
    if (!file) throw new BadRequestException('Missing file');
    const res = await this.files.upload({
      filename: file.originalname,
      contentType: file.mimetype,
      buffer: file.buffer,
      ownerType,
      ownerId,
    });
    const signed = this.files.signDownload(res.id);
    return { id: res.id, storageKey: res.storageKey, ...signed, filename: file.originalname, byteSize: file.size, contentType: file.mimetype };
  }

  @Get()
  @RequirePermissions('school:documents:read')
  list(@CurrentUser() user: AuthUser, @Query('ownerType') ownerType: string, @Query('ownerId') ownerId: string) {
    return this.files.listForOwner(ownerType, ownerId);
  }

  /**
   * The id here is attacker-controlled, so this must be the ownership-checked
   * path. `signDownload` performs no lookup and would happily sign another
   * tenant's file id — which is how one org could mint a working download link
   * for another org's applicant documents.
   */
  @Post(':id/signed-url')
  @RequirePermissions('school:documents:read')
  signedUrl(@Param('id') id: string) {
    return this.files.signDownloadForCaller(id);
  }

  /** Public-ish: the token proves the caller has the URL. No Bearer needed. */
  @Public()
  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Query('token') token: string,
    @Query('expires') expires: string,
    @Query('org') org: string,
    @Res() res: Response,
  ) {
    const file = await this.files.resolveSignedDownload(id, token, expires, org);
    res.setHeader('Content-Type', file.contentType);
    // A filename is user-supplied: strip quotes/control characters from the
    // plain form and send the exact name RFC 5987-encoded.
    const safe = file.filename.replace(/[\x00-\x1f"\\]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    if (this.files['driver'] === 'local') {
      const { stream } = this.files.streamFromDisk(file.storageKey);
      stream.pipe(res);
      return;
    }
    res.status(501).send('S3 driver not configured in this build');
  }

  @Delete(':id')
  @RequirePermissions('school:documents:write')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.files.remove(id).then(() => ({ ok: true }));
  }
}
