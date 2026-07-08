import { Body, Controller, ForbiddenException, Post, Req, Res } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { createReadStream, statSync } from 'fs';
import { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { ok } from '../common/api-response';
import { traceId } from '../common/request-util';
import { AdminServiceClient, CurrentUser } from '../integration/admin/admin-service.client';
import { hasMediaAccessPermission, hasMediaPermission, isAdmin } from '../auth/permission.util';
import { DriveService } from './drive.service';

@Public()
@Controller('internal/media')
export class InternalMediaController {
  constructor(
    private readonly driveService: DriveService,
    private readonly adminServiceClient: AdminServiceClient,
  ) {}

  @Post('list.json')
  async list(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    ensureInternalAccess(request);
    const scopedBody = await this.scopedBody(request, body);
    return ok(await this.driveService.internalMediaList(scopedBody), traceId(request));
  }

  @Post('file-detail.json')
  async fileDetail(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    ensureInternalAccess(request);
    const scopedBody = await this.scopedBody(request, body);
    return ok(await this.driveService.internalMediaFileDetail(scopedBody), traceId(request));
  }

  @Post('active-ids.json')
  async activeIds(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    ensureInternalAccess(request);
    const scopedBody = await this.scopedBody(request, body);
    return ok(await this.driveService.internalMediaActiveIds(scopedBody), traceId(request));
  }

  @Post('register-youtube.json')
  async registerYoutube(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    ensureInternalAccess(request);
    const scopedBody = await this.scopedBody(request, body, { requireWrite: true, requireAdmin: true });
    return ok(await this.driveService.internalRegisterYoutubeFile(scopedBody), traceId(request));
  }

  @Post('mark-public.json')
  async markPublic(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    ensureInternalAccess(request);
    const scopedBody = await this.scopedBody(request, body, { requireAdmin: true });
    return ok(await this.driveService.internalMarkMediaPublic(scopedBody), traceId(request));
  }

  @Post('bulk-public.json')
  async bulkPublic(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    ensureInternalAccess(request);
    const scopedBody = await this.scopedBody(request, body, { requireAdmin: true });
    return ok(await this.driveService.internalBulkMediaPublic(scopedBody), traceId(request));
  }

  @Post('file-stream.json')
  async fileStream(@Body() body: Record<string, unknown> = {}, @Req() request: Request, @Res() response: Response) {
    ensureInternalAccess(request);
    const scopedBody = await this.scopedBody(request, body, { allowPublicWithoutUserToken: true });
    const file = await this.driveService.internalMediaFileStream(scopedBody);
    const stat = statSync(file.storagePath);
    const range = parseByteRange(String(body.range || ''), stat.size);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Webhard-File-Name', encodeURIComponent(file.fileName || 'download'));
    response.setHeader('Accept-Ranges', 'bytes');
    if (file.asAttachment) {
      response.attachment(file.fileName || 'download');
    } else {
      response.setHeader('Content-Security-Policy', "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'none'; script-src 'none'; sandbox");
    }
    response.type(file.contentType);
    if (range) {
      response.status(206);
      response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
      response.setHeader('Content-Length', String(range.end - range.start + 1));
      createReadStream(file.storagePath, { start: range.start, end: range.end }).pipe(response);
      return;
    }
    response.setHeader('Content-Length', String(stat.size));
    createReadStream(file.storagePath).pipe(response);
  }

  @Post('ready.json')
  async ready(@Req() request: Request) {
    ensureInternalAccess(request);
    return ok(await this.driveService.internalMediaReady(), traceId(request));
  }

  private async scopedBody(
    request: Request,
    body: Record<string, unknown>,
    options: { requireWrite?: boolean; requireAdmin?: boolean; allowPublicWithoutUserToken?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    if (options.allowPublicWithoutUserToken && Boolean(body.allow_public) && !String(request.header('x-user-access-token') || '').trim()) {
      const viewerUserId = String(body.viewer_user_id || body.owner_user_id || '').trim();
      return {
        ...body,
        viewer_user_id: viewerUserId,
        owner_user_id: viewerUserId,
        viewer_is_admin: false,
        allow_public: true,
      };
    }

    const currentUser = await this.currentAdminUser(request);
    if (options.requireAdmin && !isAdmin(currentUser.roles)) {
      throw new ForbiddenException('admin permission is required');
    }
    if (options.requireWrite && !isAdmin(currentUser.roles) && !hasMediaPermission(currentUser.service_permissions, 'WRITE')) {
      throw new ForbiddenException('write permission is required');
    }
    const viewerUserId = String(body.viewer_user_id || body.owner_user_id || '').trim();
    if (viewerUserId && viewerUserId !== currentUser.user_id) {
      throw new ForbiddenException('viewer user does not match admin token');
    }
    return {
      ...body,
      viewer_user_id: currentUser.user_id,
      owner_user_id: currentUser.user_id,
      viewer_is_admin: isAdmin(currentUser.roles),
    };
  }

  private async currentAdminUser(request: Request): Promise<CurrentUser> {
    const token = String(request.header('x-user-access-token') || '').trim();
    if (!token) {
      throw new ForbiddenException('admin user token is required');
    }
    const currentUser = await this.adminServiceClient.fetchCurrentUser(token);
    if (!currentUser) {
      throw new ForbiddenException('admin user token is invalid');
    }
    if (!isAdmin(currentUser.roles) && !hasMediaAccessPermission(currentUser.service_permissions)) {
      throw new ForbiddenException('media permission is required');
    }
    return currentUser;
  }
}

function ensureInternalAccess(request: Request): void {
  ensureInternalToken(request);
  ensureInternalIpAllowed(request);
}

function parseByteRange(value: string, fileSize: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || fileSize <= 0) {
    return null;
  }
  const startText = match[1] || '';
  const endText = match[2] || '';
  if (!startText && !endText) {
    return null;
  }
  let start = startText ? Number(startText) : 0;
  let end = endText ? Number(endText) : fileSize - 1;
  if (!startText && endText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= fileSize) {
    return null;
  }
  return { start, end: Math.min(end, fileSize - 1) };
}

function ensureInternalToken(request: Request): void {
  const expected = internalToken();
  const provided = String(request.header('x-internal-api-token') || '').trim();
  if (!secureTokenEquals(provided, expected)) {
    throw new ForbiddenException('internal api token is invalid');
  }
}

function secureTokenEquals(provided: string, expected: string): boolean {
  if (!provided || !expected) {
    return false;
  }
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

function ensureInternalIpAllowed(request: Request): void {
  const allowed = internalAllowedIpRules();
  const clientIp = internalClientIp(request);
  if (!clientIp || !allowed.some((rule) => ipMatchesRule(clientIp, rule))) {
    throw new ForbiddenException('internal api client ip is not allowed');
  }
}

function internalToken(): string {
  const configured = String(process.env.MEDIA_INTERNAL_API_TOKEN || process.env.WEBHARD_INTERNAL_API_TOKEN || '').trim();
  if (configured) {
    if (isProductionEnv() && configured === 'dev-media-internal-token') {
      return '';
    }
    return configured;
  }
  return '';
}

function internalAllowedIpRules(): string[] {
  const configured = String(process.env.MEDIA_INTERNAL_ALLOWED_IPS || process.env.WEBHARD_INTERNAL_ALLOWED_IPS || '').trim();
  if (configured) {
    return configured.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return ['127.0.0.1', '::1'];
}

function isProductionEnv(): boolean {
  const appEnv = String(process.env.APP_ENV || process.env.NODE_ENV || '').trim().toLowerCase();
  return appEnv === 'prod' || appEnv === 'production';
}

function internalClientIp(request: Request): string {
  const forwarded = String(process.env.TRUST_FORWARDED_HEADERS || '').toLowerCase() === 'true'
    ? String(request.header('x-forwarded-for') || '').split(',')[0].trim()
    : '';
  return normalizeIp(forwarded || request.ip || request.socket.remoteAddress || '');
}

function normalizeIp(value: string): string {
  const ip = value.trim();
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

function ipMatchesRule(ip: string, rule: string): boolean {
  if (rule === ip) {
    return true;
  }
  if (!rule.includes('/')) {
    return false;
  }
  const [base, bitsText] = rule.split('/');
  const bits = Number(bitsText);
  const ipValue = ipv4ToInt(ip);
  const baseValue = ipv4ToInt(base);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32 || ipValue == null || baseValue == null) {
    return false;
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipValue & mask) === (baseValue & mask);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (((numbers[0] << 24) >>> 0) + (numbers[1] << 16) + (numbers[2] << 8) + numbers[3]) >>> 0;
}
