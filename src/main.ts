import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NextFunction, Request, Response } from 'express';
import { static as serveStatic } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';

async function bootstrap(): Promise<void> {
  validateProductionConfig();
  const app = await NestFactory.create(AppModule, { cors: false });
  if (trustForwardedHeaders()) {
    app.getHttpAdapter().getInstance().set('trust proxy', 'loopback, linklocal, uniquelocal');
  }
  app.useGlobalFilters(new ApiExceptionFilter());
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    response.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "connect-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '));
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (request.secure || String(request.header('x-forwarded-proto') || '').split(',')[0].trim() === 'https') {
      response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });
  app.use('/assets', serveStatic(join(process.cwd(), 'public'), {
    etag: true,
    immutable: true,
    maxAge: '1h',
  }));
  const port = Number(process.env.PORT || 8083);
  await app.listen(port);
}

void bootstrap();

function validateProductionConfig(): void {
  if (!isProductionEnv()) {
    return;
  }
  requireProductionUrl('PUBLIC_BASE_URL', { publicUrl: true });
  requireProductionUrl('ADMIN_SERVICE_BASE_URL');
  requireProductionUrl('ADMIN_SERVICE_PUBLIC_BASE_URL', { publicUrl: true });
  requireProductionSecret('ADMIN_INTERNAL_API_TOKEN', { fallbackName: 'MEDIA_INTERNAL_API_TOKEN' });
}

function requireProductionUrl(name: string, options: { publicUrl?: boolean } = {}): void {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required in production`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL in production`);
  }
  if (options.publicUrl && isLocalhost(url.hostname)) {
    throw new Error(`${name} must not use localhost in production`);
  }
}

function requireProductionSecret(name: string, options: { fallbackName?: string } = {}): void {
  const value = String(process.env[name] || (options.fallbackName ? process.env[options.fallbackName] : '') || '').trim();
  if (!value) {
    throw new Error(`${name} is required in production`);
  }
  if (value.length < 32 || value === 'dev-media-internal-token') {
    throw new Error(`${name} must be a strong non-default token in production`);
  }
}

function isProductionEnv(): boolean {
  const appEnv = String(process.env.APP_ENV || process.env.NODE_ENV || '').trim().toLowerCase();
  return appEnv === 'prod' || appEnv === 'production';
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function trustForwardedHeaders(): boolean {
  return String(process.env.TRUST_FORWARDED_HEADERS || '').trim().toLowerCase() === 'true';
}
