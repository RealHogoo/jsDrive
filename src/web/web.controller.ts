import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { hasAnyWebhardPermission, isAdmin } from '../auth/permission.util';
import { Public } from '../auth/public.decorator';
import { authToken } from '../common/request-util';
import { DatabaseService } from '../database/database.service';
import { AdminServiceClient } from '../integration/admin/admin-service.client';
import { DownloadJobService } from './download-job.service';

@Controller()
export class WebController {
  constructor(
    private readonly adminServiceClient: AdminServiceClient,
    private readonly databaseService: DatabaseService,
    private readonly downloadJobService: DownloadJobService,
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
  @Get('trash.html')
  async trash(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.renderProtectedPage(request, response, 'trash.html');
  }

  @Public()
  @Get('search.html')
  async search(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.renderProtectedPage(request, response, 'search.html');
  }

  @Public()
  @Get('download-jobs.html')
  async downloadJobs(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.renderProtectedPage(request, response, 'download-jobs.html');
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
  @Get('file/thumbnail/:fileId')
  async fileThumbnail(@Param('fileId') fileId: string, @Req() request: Request, @Res() response: Response): Promise<void> {
    const currentUser = await this.currentUser(request);
    if (!currentUser) {
      this.renderError(response, 401);
      return;
    }
    const file = await this.findOwnedFile(fileId, currentUser.user_id);
    if (!file || !file.thumbnail_path || !existsSync(file.thumbnail_path)) {
      this.renderError(response, 404, '썸네일을 찾을 수 없습니다.');
      return;
    }
    response.type('image/webp');
    response.sendFile(file.thumbnail_path);
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
    const job = await this.downloadJobService.startWeekDownload({
      week_start: weekStart,
      content_kind: request.query.content_kind,
      sort_basis: request.query.sort_basis,
    }, { userId: currentUser.user_id });
    response.redirect(`/preview-detail.html?week_start=${encodeURIComponent(weekStart)}&download_job_id=${encodeURIComponent(String(job.job_id || ''))}`);
  }

  @Public()
  @Get('download/file/:jobId')
  async downloadFile(@Param('jobId') jobId: string, @Req() request: Request, @Res() response: Response): Promise<void> {
    const currentUser = await this.currentUser(request);
    if (!currentUser) {
      this.renderError(response, 401);
      return;
    }
    const job = await this.downloadJobService.completedJob(jobId, currentUser.user_id);
    if (!job) {
      this.renderError(response, 404, '다운로드 파일을 찾을 수 없습니다.');
      return;
    }
    response.download(job.zip_path, job.download_name || 'webhard.zip');
  }

  @Public()
  @Get('*')
  async notFound(@Req() request: Request, @Res() response: Response): Promise<void> {
    this.renderError(response, 404, '요청한 화면을 찾을 수 없습니다.');
  }

  private async renderProtectedPage(
    request: Request,
    response: Response,
    pageName: 'index.html' | 'upload.html' | 'preview.html' | 'preview-detail.html' | 'file-detail.html' | 'trash.html' | 'search.html' | 'download-jobs.html' | 'indexing.html',
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
      thumbnail_path: string | null;
      content_type: string;
    }>(
      `
      SELECT file_name, storage_path, thumbnail_path, content_type
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
