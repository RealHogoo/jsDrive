import { All, Controller, Get, Param, Req, Res } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { once } from 'events';
import { Request, Response } from 'express';
import { createWriteStream, existsSync, readFileSync } from 'fs';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { hasAnyWebhardPermission, isAdmin } from '../auth/permission.util';
import { Public } from '../auth/public.decorator';
import { authToken } from '../common/request-util';
import { DatabaseService } from '../database/database.service';
import { AdminServiceClient } from '../integration/admin/admin-service.client';

const { ZipArchive } = require('archiver') as {
  ZipArchive: new (options: { zlib: { level: number } }) => any;
};

@Controller()
export class WebController {
  constructor(
    private readonly adminServiceClient: AdminServiceClient,
    private readonly databaseService: DatabaseService,
  ) {}

  @Public()
  @Get()
  async index(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.renderProtectedPage(request, response, 'index.html');
  }

  @Public()
  @Get('index.html')
  async indexHtml(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.renderProtectedPage(request, response, 'index.html');
  }

  @Public()
  @Get('upload.html')
  async upload(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.renderProtectedPage(request, response, 'upload.html');
  }

  @Public()
  @Get('preview.html')
  async preview(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.renderProtectedPage(request, response, 'preview.html');
  }

  @Public()
  @Get('preview-detail.html')
  async previewDetail(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.renderProtectedPage(request, response, 'preview-detail.html');
  }

  @Public()
  @Get('file-detail.html')
  async fileDetail(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.renderProtectedPage(request, response, 'file-detail.html');
  }

  @Public()
  @Get('indexing.html')
  async indexing(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.renderProtectedPage(request, response, 'indexing.html');
  }

  @Public()
  @Get('error.html')
  async error(@Res() response: Response): Promise<void> {
    response.sendFile(pagePath('error.html'));
  }

  @Public()
  @Get('file/content/:fileId')
  async fileContent(@Param('fileId') fileId: string, @Req() request: Request, @Res() response: Response): Promise<void> {
    const currentUser = await this.currentUser(request);
    if (!currentUser) {
      this.renderError(response, 401);
      return;
    }
    const file = await this.findOwnedFile(fileId, currentUser.user_id);
    if (!file || !file.storage_path || !existsSync(file.storage_path)) {
      this.renderError(response, 404, '요청한 파일을 찾을 수 없습니다.');
      return;
    }
    response.type(file.content_type || 'application/octet-stream');
    response.sendFile(file.storage_path);
  }

  @Public()
  @Get('file/download/:fileId')
  async fileDownload(@Param('fileId') fileId: string, @Req() request: Request, @Res() response: Response): Promise<void> {
    const currentUser = await this.currentUser(request);
    if (!currentUser) {
      this.renderError(response, 401);
      return;
    }
    const file = await this.findOwnedFile(fileId, currentUser.user_id);
    if (!file || !file.storage_path || !existsSync(file.storage_path)) {
      this.renderError(response, 404, '다운로드할 파일을 찾을 수 없습니다.');
      return;
    }
    response.download(file.storage_path, file.file_name || 'download');
  }

  @Public()
  @Get(['file/week-download', 'file/week-download.zip'])
  async weekDownload(@Req() request: Request, @Res() response: Response): Promise<void> {
    const currentUser = await this.currentUser(request);
    if (!currentUser) {
      this.renderError(response, 401);
      return;
    }
    const weekStart = String(request.query.week_start || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      this.renderError(response, 400, '다운로드 기준 주차가 올바르지 않습니다.');
      return;
    }
    const contentKind = normalizeContentKind(request.query.content_kind);
    const sortBasis = normalizeSortBasis(request.query.sort_basis);
    const dateColumn = sortBasis === 'UPLOADED' ? 'created_at' : 'original_created_at';
    const start = new Date(`${weekStart}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const result = await this.databaseService.query<{
      file_id: number;
      file_name: string;
      file_size: string;
      storage_path: string;
    }>(
      `
      SELECT file_id, file_name, file_size, storage_path
      FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'N'
        AND ${dateColumn} >= CAST($2 AS timestamp)
        AND ${dateColumn} < CAST($3 AS timestamp)
        AND ($4::varchar IS NULL OR content_kind = $4)
      ORDER BY ${dateColumn} DESC, file_id DESC
      `,
      [currentUser.user_id, start.toISOString(), end.toISOString(), contentKind],
    );
    const files = result.rows.filter((file) => file.storage_path && existsSync(file.storage_path));
    if (files.length === 0) {
      this.renderError(response, 404, '다운로드할 파일이 없습니다.');
      return;
    }
    const zipLimits = weekDownloadLimits();
    const totalBytes = files.reduce((sum, file) => sum + Number(file.file_size || 0), 0);
    if (files.length > zipLimits.maxFiles || totalBytes > zipLimits.maxBytes) {
      this.renderError(response, 400, '다운로드할 파일이 너무 많습니다. 필터를 줄여서 다시 시도하세요.');
      return;
    }
    const zipPath = await createZipFile(files, weekStart);
    response.download(zipPath, `webhard-${weekStart}.zip`, async () => {
      await unlink(zipPath).catch(() => undefined);
    });
  }

  @Public()
  @All('*')
  async notFound(@Req() request: Request, @Res() response: Response): Promise<void> {
    if (request.method.toUpperCase() === 'GET') {
      this.renderError(response, 404, '요청한 화면을 찾을 수 없습니다.');
      return;
    }
    response.status(404).json({
      ok: false,
      code: 'NOT_FOUND',
      message: 'not found',
      data: null,
      trace_id: null,
    });
  }

  private async renderProtectedPage(
    request: Request,
    response: Response,
    pageName: 'index.html' | 'upload.html' | 'preview.html' | 'preview-detail.html' | 'file-detail.html' | 'indexing.html',
  ): Promise<void> {
    const currentUser = await this.currentUser(request);
    if (!currentUser) {
      response.redirect(this.loginUrl(request));
      return;
    }
    if (!isAdmin(currentUser.roles) && !hasAnyWebhardPermission(currentUser.service_permissions)) {
      this.renderError(response, 403);
      return;
    }

    response.sendFile(pagePath(pageName));
  }

  private async currentUser(request: Request) {
    const token = authToken(request);
    if (!token) {
      return null;
    }
    return this.adminServiceClient.fetchCurrentUser(token);
  }

  private renderError(response: Response, status: number, message?: string): void {
    const bootstrap = `<script>window.WEBHARD_ERROR_CODE=${JSON.stringify(String(status))};`
      + `window.WEBHARD_ERROR_MESSAGE=${JSON.stringify(message || '')};</script>`;
    const html = readFileSync(pagePath('error.html'), 'utf8').replace('</head>', `${bootstrap}</head>`);
    response.status(status).type('html').send(html);
  }

  private async findOwnedFile(fileId: string, ownerUserId: string) {
    const parsedFileId = Number(fileId);
    if (!Number.isSafeInteger(parsedFileId) || parsedFileId <= 0) {
      return null;
    }
    const result = await this.databaseService.query<{
      file_name: string;
      storage_path: string;
      content_type: string;
    }>(
      `
      SELECT file_name, storage_path, content_type
      FROM wh_file
      WHERE file_id = $1
        AND owner_user_id = $2
        AND deleted_yn = 'N'
      `,
      [parsedFileId, ownerUserId],
    );
    return result.rows[0] || null;
  }

  private loginUrl(request: Request): string {
    const adminBaseUrl = trimTrailingSlash(
      process.env.ADMIN_SERVICE_PUBLIC_BASE_URL || process.env.ADMIN_SERVICE_BASE_URL || 'http://localhost:8081',
    );
    const returnUrl = `${publicBaseUrl(request)}${request.originalUrl || '/'}`;
    return `${adminBaseUrl}/service-login-page.do?service_nm=${encodeURIComponent('Webhard Service')}`
      + `&return_url=${encodeURIComponent(returnUrl)}`;
  }
}

function pagePath(pageName: string): string {
  const distPath = join(process.cwd(), 'dist', 'web', 'pages', pageName);
  if (existsSync(distPath)) {
    return distPath;
  }
  return join(process.cwd(), 'src', 'web', 'pages', pageName);
}

function publicBaseUrl(request: Request): string {
  const configured = trimTrailingSlash(process.env.PUBLIC_BASE_URL || '');
  if (configured) {
    return configured;
  }
  const trustForwardedHeaders = String(process.env.TRUST_FORWARDED_HEADERS || '').toLowerCase() === 'true';
  const proto = (trustForwardedHeaders ? firstHeaderValue(request.header('x-forwarded-proto')) : null)
    || request.protocol
    || 'http';
  const host = (trustForwardedHeaders ? firstHeaderValue(request.header('x-forwarded-host')) : null)
    || request.header('host')
    || 'localhost:8083';
  return `${proto}://${host}`;
}

function firstHeaderValue(value: string | undefined): string | null {
  if (!value || !value.trim()) {
    return null;
  }
  return value.split(',')[0].trim();
}

function trimTrailingSlash(value: string): string {
  let normalized = value.trim();
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function normalizeContentKind(value: unknown): string | null {
  const text = String(value || '').trim().toUpperCase();
  if (!text || text === 'ALL') {
    return null;
  }
  return text === 'IMAGE' || text === 'VIDEO' || text === 'DOCUMENT' ? text : null;
}

function normalizeSortBasis(value: unknown): 'ORIGINAL_CREATED' | 'UPLOADED' {
  const text = String(value || '').trim().toUpperCase();
  if (!text || text === 'ORIGINAL_CREATED') {
    return 'ORIGINAL_CREATED';
  }
  return text === 'UPLOADED' || text === 'CREATED_AT' ? 'UPLOADED' : 'ORIGINAL_CREATED';
}

function zipEntryName(fileName: string, index: number): string {
  const safe = fileName.replace(/[\\/:*?"<>|]/g, '_').trim() || `file-${index + 1}`;
  return `${String(index + 1).padStart(3, '0')}-${safe}`;
}

async function createZipFile(
  files: Array<{ file_id: number; file_name: string; storage_path: string }>,
  weekStart: string,
): Promise<string> {
  const zipPath = join(tmpdir(), `webhard-${weekStart}-${randomUUID()}.zip`);
  const output = createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const closed = once(output, 'close');
  const failed = Promise.race([
    once(output, 'error').then(([error]) => Promise.reject(error)),
    once(archive, 'error').then(([error]) => Promise.reject(error)),
  ]);
  archive.pipe(output);
  files.forEach((file, index) => {
    archive.file(file.storage_path, { name: zipEntryName(file.file_name || `file-${file.file_id}`, index) });
  });
  await archive.finalize();
  await Promise.race([closed, failed]);
  return zipPath;
}

function weekDownloadLimits(): { maxFiles: number; maxBytes: number } {
  return {
    maxFiles: positiveNumberEnv('WEBHARD_WEEK_DOWNLOAD_MAX_FILES') || 500,
    maxBytes: positiveNumberEnv('WEBHARD_WEEK_DOWNLOAD_MAX_BYTES')
      || (positiveNumberEnv('WEBHARD_WEEK_DOWNLOAD_MAX_MB') || 2048) * 1024 * 1024,
  };
}

function positiveNumberEnv(key: string): number | null {
  const parsed = Number(process.env[key] || '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
