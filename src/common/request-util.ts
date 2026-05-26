import { Request } from 'express';

type AuthTokenSource = 'bearer' | 'cookie' | '';

export function bearerToken(request: Request): string {
  const authorization = request.header('authorization');
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return '';
  }
  return authorization.slice('Bearer '.length).trim();
}

export function authToken(request: Request): string {
  return authTokenWithSource(request).token;
}

export function authTokenWithSource(request: Request): { token: string; source: AuthTokenSource } {
  const bearer = bearerToken(request);
  if (bearer) {
    return { token: bearer, source: 'bearer' };
  }
  const cookie = cookieValue(request, 'ACCESS_TOKEN');
  return { token: cookie, source: cookie ? 'cookie' : '' };
}

export function cookieValue(request: Request, name: string): string {
  const cookie = request.header('cookie');
  if (!cookie) {
    return '';
  }
  const prefix = `${name}=`;
  for (const part of cookie.split(';')) {
    const item = part.trim();
    if (item.startsWith(prefix)) {
      return decodeURIComponent(item.slice(prefix.length)).trim();
    }
  }
  return '';
}

export function traceId(request: Request): string | null {
  return request.header('x-trace-id') || null;
}

export function isCrossSiteRequest(request: Request): boolean {
  const secFetchSite = request.header('sec-fetch-site');
  if (secFetchSite) {
    const normalized = secFetchSite.trim().toLowerCase();
    if (normalized === 'cross-site') {
      return true;
    }
    if (normalized === 'same-origin' || normalized === 'same-site' || normalized === 'none') {
      return false;
    }
  }

  return !isSameOrigin(request, request.header('origin')) || !isSameOrigin(request, request.header('referer'));
}

function isSameOrigin(request: Request, source: string | undefined): boolean {
  if (!source || !source.trim()) {
    return true;
  }

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source.trim());
  } catch {
    return false;
  }

  const requestProtocol = forwardedProtocol(request);
  const requestHost = forwardedHost(request);
  const requestPort = forwardedPort(request, requestProtocol);
  if (!sourceUrl.protocol || !sourceUrl.hostname || !requestHost) {
    return false;
  }

  const sourceProtocol = sourceUrl.protocol.replace(/:$/, '');
  return sourceProtocol.toLowerCase() === requestProtocol.toLowerCase()
    && sourceUrl.hostname.toLowerCase() === requestHost.toLowerCase()
    && normalizePort(sourceUrl.port ? Number(sourceUrl.port) : -1, sourceProtocol) === normalizePort(requestPort, requestProtocol);
}

function forwardedProtocol(request: Request): string {
  const forwarded = trustedForwardedHeaders() ? request.header('x-forwarded-proto') : '';
  return firstHeaderValue(forwarded) || request.protocol || 'http';
}

function forwardedHost(request: Request): string {
  const forwarded = trustedForwardedHeaders() ? request.header('x-forwarded-host') : '';
  const host = firstHeaderValue(forwarded) || request.hostname || request.header('host') || '';
  return host.split(':')[0].trim();
}

function forwardedPort(request: Request, protocol: string): number {
  const forwarded = trustedForwardedHeaders() ? request.header('x-forwarded-port') : '';
  const value = firstHeaderValue(forwarded);
  if (value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const host = request.header('host') || '';
  const hostPort = host.includes(':') ? Number(host.split(':').pop()) : -1;
  if (Number.isFinite(hostPort) && hostPort > 0) {
    return hostPort;
  }
  return normalizePort(-1, protocol);
}

function normalizePort(port: number, protocol: string): number {
  if (port > 0) {
    return port;
  }
  return protocol.toLowerCase() === 'https' ? 443 : 80;
}

function firstHeaderValue(value: string | undefined): string {
  return value ? value.split(',')[0].trim() : '';
}

function trustedForwardedHeaders(): boolean {
  return String(process.env.TRUST_FORWARDED_HEADERS || '').toLowerCase() === 'true';
}
