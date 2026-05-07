import { Request } from 'express';

export function bearerToken(request: Request): string {
  const authorization = request.header('authorization');
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return '';
  }
  return authorization.slice('Bearer '.length).trim();
}

export function authToken(request: Request): string {
  const bearer = bearerToken(request);
  if (bearer) {
    return bearer;
  }
  return cookieValue(request, 'ACCESS_TOKEN');
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
