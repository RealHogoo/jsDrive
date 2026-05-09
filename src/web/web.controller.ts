import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { existsSync } from 'fs';
import { join } from 'path';
import { hasAnyWebhardPermission, isAdmin } from '../auth/permission.util';
import { Public } from '../auth/public.decorator';
import { authToken } from '../common/request-util';
import { AdminServiceClient } from '../integration/admin/admin-service.client';

@Controller()
export class WebController {
  constructor(private readonly adminServiceClient: AdminServiceClient) {}

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
  @Get('indexing.html')
  async indexing(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.renderProtectedPage(request, response, 'indexing.html');
  }

  private async renderProtectedPage(
    request: Request,
    response: Response,
    pageName: 'index.html' | 'upload.html' | 'preview.html' | 'indexing.html',
  ): Promise<void> {
    const token = authToken(request);
    if (!token) {
      response.redirect(this.loginUrl(request));
      return;
    }

    const currentUser = await this.adminServiceClient.fetchCurrentUser(token);
    if (!currentUser) {
      response.redirect(this.loginUrl(request));
      return;
    }
    if (!isAdmin(currentUser.roles) && !hasAnyWebhardPermission(currentUser.service_permissions)) {
      response.status(403).send('권한이 없습니다. 관리자에게 웹하드 접근 권한 설정을 요청하세요.');
      return;
    }

    response.sendFile(pagePath(pageName));
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
  const proto = firstHeaderValue(request.header('x-forwarded-proto')) || request.protocol || 'http';
  const host = firstHeaderValue(request.header('x-forwarded-host')) || request.header('host') || 'localhost:8083';
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
