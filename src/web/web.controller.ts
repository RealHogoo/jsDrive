import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { scryptSync, timingSafeEqual } from 'crypto';
import { once } from 'events';
import { Request, Response } from 'express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { hasAnyWebhardPermission, isAdmin } from '../auth/permission.util';
import { Public } from '../auth/public.decorator';
import { authToken } from '../common/request-util';
import { DatabaseService } from '../database/database.service';
import { AdminServiceClient } from '../integration/admin/admin-service.client';
import { VersionService } from '../version/version.service';
import { DownloadJobService } from './download-job.service';

const archiver = require('archiver') as (format: string, options: { zlib: { level: number } }) => any;

@Controller()
export class WebController {
  constructor(
    private readonly adminServiceClient: AdminServiceClient,
    private readonly databaseService: DatabaseService,
    private readonly downloadJobService: DownloadJobService,
    private readonly versionService: VersionService,
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
  @Get('dashboard.html')
  async dashboard(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.renderProtectedPage(request, response, 'dashboard.html');
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
  @Get('shares.html')
  async shares(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.renderProtectedPage(request, response, 'shares.html');
  }

  @Public()
  @Get('audit.html')
  async audit(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.renderProtectedPage(request, response, 'audit.html');
  }

  @Public()
  @Get('error.html')
  async error(@Res() response: Response): Promise<void> {
    response.sendFile(pagePath('error.html'));
  }

  @Public()
  @Get('s/:token')
  async sharePage(@Param('token') token: string, @Res() response: Response): Promise<void> {
    const bootstrap = `<script>window.WEBHARD_SHARE_TOKEN=${JSON.stringify(token || '')};</script>`;
    const html = pageHtml('share.html').replace('</head>', `${bootstrap}</head>`);
    response.type('html').send(html);
  }

  @Public()
  @Get('share/download/:token')
  async shareDownload(@Param('token') token: string, @Res() response: Response): Promise<void> {
    const share = await this.findShare(token, '', { allowMissingPassword: true });
    if (share?.password_hash) {
      this.renderError(response, 403, '비밀번호가 필요한 공유 링크입니다.');
      return;
    }
    await this.sendSharedItem(share, response);
  }

  @Public()
  @Post('share/download/:token')
  async shareDownloadWithPassword(
    @Param('token') token: string,
    @Body() body: Record<string, unknown> = {},
    @Res() response: Response,
  ): Promise<void> {
    const share = await this.findShare(token, String(body.password || ''));
    await this.sendSharedItem(share, response);
  }

  private async sendSharedItem(
    share: {
      share_id: number;
      file_id: number | null;
      folder_id: number | null;
      folder_name: string | null;
      storage_path: string | null;
      display_name: string | null;
      file_name: string | null;
    } | null,
    response: Response,
  ): Promise<void> {
    if (share?.folder_id) {
      await this.sendSharedFolder(share, response);
      return;
    }
    await this.sendSharedFile(share, response);
  }

  private async sendSharedFile(
    share: {
      share_id: number;
      storage_path: string | null;
      display_name: string | null;
      file_name: string | null;
    } | null,
    response: Response,
  ): Promise<void> {
    if (!share || !share.storage_path || !existsSync(share.storage_path)) {
      this.renderError(response, 404, '공유 파일을 찾을 수 없습니다.');
      return;
    }
    await this.databaseService.query(
      `
      UPDATE wh_share
      SET download_count = download_count + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE share_id = $1
      `,
      [share.share_id],
    );
    response.download(share.storage_path, share.display_name || share.file_name || 'download');
  }

  private async sendSharedFolder(
    share: {
      share_id: number;
      folder_id: number | null;
      folder_name: string | null;
    },
    response: Response,
  ): Promise<void> {
    const files = await this.sharedFolderFiles(share.folder_id);
    const existingFiles = files.filter((file) => file.storage_path && existsSync(file.storage_path));
    if (existingFiles.length === 0) {
      this.renderError(response, 404, '공유 폴더에 다운로드할 파일이 없습니다.');
      return;
    }
    await this.incrementShareDownloadCount(share.share_id);
    const archive = archiver('zip', { zlib: { level: 6 } });
    const failed = Promise.race([
      once(response, 'error').then(([error]) => Promise.reject(error)),
      once(archive, 'error').then(([error]) => Promise.reject(error)),
    ]);
    const finished = once(response, 'finish');
    response.attachment(`${safeDownloadName(share.folder_name || 'folder')}.zip`);
    archive.pipe(response);
    existingFiles.forEach((file, index) => {
      archive.file(file.storage_path, { name: sharedZipEntryName(file, index) });
    });
    await archive.finalize();
    await Promise.race([finished, failed]);
  }

  private async incrementShareDownloadCount(shareId: number): Promise<void> {
    await this.databaseService.query(
      `
      UPDATE wh_share
      SET download_count = download_count + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE share_id = $1
      `,
      [shareId],
    );
  }

  private async sharedFolderFiles(folderId: number | null): Promise<Array<{
    file_id: number;
    file_name: string | null;
    display_name: string | null;
    storage_path: string;
    folder_path: string;
  }>> {
    if (!folderId) {
      return [];
    }
    const result = await this.databaseService.query<{
      file_id: number;
      file_name: string | null;
      display_name: string | null;
      storage_path: string;
      folder_path: string;
    }>(
      `
      WITH RECURSIVE folders AS (
        SELECT folder_id, parent_folder_id, folder_name, folder_name::text AS folder_path
        FROM wh_folder
        WHERE folder_id = $1
          AND deleted_yn = 'N'
        UNION ALL
        SELECT child.folder_id, child.parent_folder_id, child.folder_name,
               folders.folder_path || '/' || child.folder_name
        FROM wh_folder child
        JOIN folders ON child.parent_folder_id = folders.folder_id
        WHERE child.deleted_yn = 'N'
      )
      SELECT f.file_id, f.file_name, f.display_name, f.storage_path, folders.folder_path
      FROM folders
      JOIN wh_file f ON f.folder_id = folders.folder_id
      WHERE f.deleted_yn = 'N'
      ORDER BY folders.folder_path ASC, f.file_name ASC, f.file_id ASC
      `,
      [folderId],
    );
    return result.rows;
  }

  @Public()
  @Get('file/content/:fileId')
  async fileContent(@Param('fileId') fileId: string, @Req() request: Request, @Res() response: Response): Promise<void> {
    const currentUser = await this.currentWebhardUser(request, response);
    if (!currentUser) {
      return;
    }
    const file = await this.findOwnedFile(fileId, currentUser.user_id);
    if (!file || !file.storage_path || !existsSync(file.storage_path)) {
      this.renderError(response, 404, '요청한 파일을 찾을 수 없습니다.');
      return;
    }
    const contentType = safeInlineContentType(file.content_type);
    if (!contentType) {
      response.download(file.storage_path, file.file_name || 'download');
      return;
    }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'none'; script-src 'none'; sandbox");
    response.type(contentType);
    response.sendFile(file.storage_path);
  }

  @Public()
  @Get('file/thumbnail/:fileId')
  async fileThumbnail(@Param('fileId') fileId: string, @Req() request: Request, @Res() response: Response): Promise<void> {
    const currentUser = await this.currentWebhardUser(request, response);
    if (!currentUser) {
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
    const currentUser = await this.currentWebhardUser(request, response);
    if (!currentUser) {
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
    const currentUser = await this.currentWebhardUser(request, response);
    if (!currentUser) {
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
    const currentUser = await this.currentWebhardUser(request, response);
    if (!currentUser) {
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
    pageName: 'index.html' | 'upload.html' | 'dashboard.html' | 'preview.html' | 'preview-detail.html' | 'file-detail.html' | 'trash.html' | 'search.html' | 'download-jobs.html' | 'indexing.html' | 'shares.html' | 'audit.html',
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

    const html = pageHtml(pageName);
    response.type('html').send(injectVersionBadge(html, this.versionService.version()));
  }

  private async currentUser(request: Request) {
    const token = authToken(request);
    if (!token) {
      return null;
    }
    return this.adminServiceClient.fetchCurrentUser(token);
  }

  private async currentWebhardUser(request: Request, response: Response) {
    const currentUser = await this.currentUser(request);
    if (!currentUser) {
      this.renderError(response, 401);
      return null;
    }
    if (!isAdmin(currentUser.roles) && !hasAnyWebhardPermission(currentUser.service_permissions)) {
      this.renderError(response, 403);
      return null;
    }
    return currentUser;
  }

  private renderError(response: Response, status: number, message?: string): void {
    const bootstrap = `<script>window.WEBHARD_ERROR_CODE=${JSON.stringify(String(status))};`
      + `window.WEBHARD_ERROR_MESSAGE=${JSON.stringify(message || '')};</script>`;
    const html = pageHtml('error.html').replace('</head>', `${bootstrap}</head>`);
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

  private async findShare(token: string, password: string, options: { allowMissingPassword?: boolean } = {}) {
    if (!/^[a-f0-9]{48}$/i.test(token || '')) {
      return null;
    }
    const result = await this.databaseService.query<{
      share_id: number;
      file_id: number | null;
      folder_id: number | null;
      folder_name: string | null;
      password_hash: string | null;
      max_download_count: number | null;
      download_count: number;
      file_name: string | null;
      display_name: string | null;
      storage_path: string | null;
      content_type: string | null;
      content_kind: string | null;
      file_size: string | null;
      thumbnail_path: string | null;
      expires_at: string | null;
    }>(
      `
      SELECT s.share_id, s.file_id, s.folder_id, s.password_hash, s.max_download_count,
             s.download_count, s.expires_at,
             f.file_name, f.display_name, f.storage_path, f.content_type, f.content_kind,
             f.file_size, f.thumbnail_path,
             folder.folder_name
      FROM wh_share s
      LEFT JOIN wh_file f ON f.file_id = s.file_id AND f.deleted_yn = 'N'
      LEFT JOIN wh_folder folder ON folder.folder_id = s.folder_id AND folder.deleted_yn = 'N'
      WHERE s.share_token = $1
        AND s.revoked_yn = 'N'
        AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
        AND (s.max_download_count IS NULL OR s.download_count < s.max_download_count)
      `,
      [token],
    );
    const share = result.rows[0];
    if (!share) {
      return null;
    }
    if (options.allowMissingPassword && share.password_hash && !password) {
      return share;
    }
    if (!verifySharePassword(password, share.password_hash)) {
      return null;
    }
    return share;
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

const PAGE_HTML_CACHE = new Map<string, string>();

function pageHtml(pageName: string): string {
  const cached = PAGE_HTML_CACHE.get(pageName);
  if (cached !== undefined) {
    return cached;
  }
  const html = readFileSync(pagePath(pageName), 'utf8');
  PAGE_HTML_CACHE.set(pageName, html);
  return html;
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

function safeInlineContentType(contentType: string | null | undefined): string | null {
  const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
  return SAFE_INLINE_CONTENT_TYPES.has(normalized) ? normalized : null;
}

const SAFE_INLINE_CONTENT_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/ogg',
  'video/quicktime',
  'video/webm',
]);

function injectVersionBadge(html: string, version: { service: string; revision: string }): string {
  const badge = `<div class="build-version" aria-label="Git revision">${escapeHtml(version.service)} ${escapeHtml(version.revision)}</div>`;
  if (html.includes('</body>')) {
    return html.replace('</body>', `${badge}</body>`);
  }
  return `${html}${badge}`;
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeDownloadName(value: string): string {
  return String(value || 'download').replace(/[\\/:*?"<>|]/g, '_').trim() || 'download';
}

function sharedZipEntryName(
  file: { file_id: number; file_name: string | null; display_name: string | null; folder_path: string },
  index: number,
): string {
  const folders = String(file.folder_path || '')
    .split('/')
    .map(safeZipSegment)
    .filter(Boolean);
  const fileName = safeZipSegment(file.display_name || file.file_name || `file-${file.file_id}`);
  return [...folders, `${String(index + 1).padStart(3, '0')}-${fileName}`].join('/');
}

function safeZipSegment(value: string): string {
  return String(value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+$/, '_')
    .trim()
    .slice(0, 180) || 'item';
}

function verifySharePassword(password: string, storedHash: string | null): boolean {
  if (!storedHash) {
    return true;
  }
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const expected = Buffer.from(parts[2], 'hex');
  const actual = scryptSync(password || '', parts[1], expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
