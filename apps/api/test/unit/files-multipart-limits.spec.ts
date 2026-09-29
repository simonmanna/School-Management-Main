import { Controller, INestApplication, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { UPLOAD_OPTIONS } from '../../src/kernel/files/upload-limits';

/**
 * Audit 2026-09-29 A04: the upload parser had field-name/index DoS advisories.
 * The shipped parser must be patched (>= 2.3.0), and every upload route bounds
 * the multipart body — malformed or oversized parts are refused with a 4xx and
 * the process keeps serving.
 */
@Controller('t')
class UploadProbeController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  upload(@UploadedFile() file: any) {
    return { size: file?.size ?? 0 };
  }
}

describe('multipart upload limits (A04)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [UploadProbeController] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves a patched multer', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const version: string = require('multer/package.json').version;
    const [major, minor] = version.split('.').map(Number);
    expect(major > 2 || (major === 2 && minor >= 3)).toBe(true);
  });

  it('accepts an ordinary upload', async () => {
    const res = await request(app.getHttpServer())
      .post('/t/upload')
      .field('ownerType', 'student')
      .attach('file', Buffer.from('hello'), 'a.txt');
    expect(res.status).toBe(201);
    expect(res.body.size).toBe(5);
  });

  it('refuses an overlong field name', async () => {
    const res = await request(app.getHttpServer())
      .post('/t/upload')
      .field('x'.repeat(5_000), 'v')
      .attach('file', Buffer.from('hello'), 'a.txt');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('refuses deeply indexed and excessive fields', async () => {
    let req = request(app.getHttpServer()).post('/t/upload');
    for (let i = 0; i < 60; i++) req = req.field(`a[${i}][${i}][${i}]`, 'v');
    const res = await req.attach('file', Buffer.from('hello'), 'a.txt');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('refuses a second file', async () => {
    const res = await request(app.getHttpServer())
      .post('/t/upload')
      .attach('file', Buffer.from('a'), 'a.txt')
      .attach('file', Buffer.from('b'), 'b.txt');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('still serves after malformed input', async () => {
    const res = await request(app.getHttpServer())
      .post('/t/upload')
      .attach('file', Buffer.from('ok'), 'a.txt');
    expect(res.status).toBe(201);
  });
});
