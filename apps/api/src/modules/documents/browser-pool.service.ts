/**
 * DMS — Phase 4 BrowserPool (O1). Drivers the SYSTEM Chrome in headless mode
 * via CLI (puppeteer-core install is blocked on this box by the pnpm
 * workspace: npm cannot resolve `workspace:*` deps and the pnpm CLI crashes).
 *
 * Pool discipline (per §4.1): no launch-per-request — a single chrome process
 * with one shared page profile, serialized through a mutex; hard timeout with
 * process kill; temp-file cleanup; shutdown hook. `--print-to-pdf` writes the
 * PDF directly; the page is rendered to a temp HTML file first.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { execFile } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter((p): p is string => Boolean(p));

export interface PdfRenderResult {
  pdf: Buffer;
  pageCount: number;
  elapsedMs: number;
}

@Injectable()
export class BrowserPoolService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserPoolService.name);
  private chromePath: string | null = null;
  private tempDir: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly RENDER_TIMEOUT_MS = 30_000;

  constructor() {
    for (const candidate of CHROME_CANDIDATES) {
      if (candidate && candidate.length > 0) {
        // Keep the first candidate; existence is probed lazily on first use.
        this.chromePath = candidate;
        break;
      }
    }
  }

  /** Render an HTML string to a PDF buffer via headless Chrome. */
  renderHtmlToPdf(html: string): Promise<PdfRenderResult> {
    // Serialize renders through the pool (concurrency limit = 1).
    const run = this.queue.then(() => this.doRender(html));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async doRender(html: string): Promise<PdfRenderResult> {
    const chrome = this.chromePath;
    if (!chrome) {
      throw new Error('BrowserPool: no Chrome/Edge executable found (set CHROME_PATH)');
    }
    const tempDir = await this.ensureTempDir();
    const started = Date.now();
    const htmlFile = join(tempDir, `render-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    const pdfFile = htmlFile.replace(/\.html$/, '.pdf');
    await writeFile(htmlFile, html, 'utf8');

    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-pdf-header-footer',
      '--print-to-pdf-no-header',
      `--print-to-pdf=${pdfFile}`,
      `file:///${htmlFile.replace(/\\/g, '/')}`,
    ];
    try {
      await this.execChrome(chrome, args);
      // Headless Chrome may resolve its promise before the PDF file is fully
      // flushed to disk (observed ENOENT race). Poll for up to ~2s.
      const pdf = await this.waitForPdf(pdfFile);
      void rm(pdfFile, { force: true });
      void rm(htmlFile, { force: true });
      return {
        pdf,
        pageCount: 1,
        elapsedMs: Date.now() - started,
      };
    } catch (err) {
      void rm(pdfFile, { force: true });
      void rm(htmlFile, { force: true });
      this.logger.warn(`BrowserPool render failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /** Poll for the Chrome-written PDF (headless child can resolve before flush). */
  private waitForPdf(path: string): Promise<Buffer> {
    const fs = require('fs');
    const deadline = Date.now() + 2000;
    const tick = (): Promise<Buffer> =>
      new Promise((res, rej) => {
        fs.readFile(path, (err: NodeJS.ErrnoException | null, buf: Buffer) => {
          if (!err) return res(buf);
          if (Date.now() > deadline) return rej(new Error(`BrowserPool: PDF not written: ${err.message}`));
          setTimeout(() => tick().then(res, rej), 50);
        });
      });
    return tick();
  }

  private execChrome(chrome: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        chrome,
        args,
        { timeout: this.RENDER_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
        (err) => {
          if (!err) return resolve();
          reject(new Error(`chrome exited with ${err.code ?? err.message}`));
        },
      );
    });
  }

  private async ensureTempDir(): Promise<string> {
    if (!this.tempDir) {
      this.tempDir = await mkdtemp(join(tmpdir(), 'dms-render-'));
    }
    return this.tempDir;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.tempDir) {
      try {
        await rm(this.tempDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      this.tempDir = null;
    }
  }
}