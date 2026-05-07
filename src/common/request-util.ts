import { Request } from 'express';

export function bearerToken(request: Request): string {
  const authorization = request.header('authorization');
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return '';
  }
  return authorization.slice('Bearer '.length).trim();
}

export function traceId(request: Request): string | null {
  return request.header('x-trace-id') || null;
}
