import { isAbsolute, resolve } from 'path';

export function storageRoot(): string {
  if (isProductionEnv() && !process.env.WEBHARD_STORAGE_ROOT && !process.env.WEBHARD_STORAGE_DIR) {
    throw new Error('WEBHARD_STORAGE_ROOT is required in production');
  }
  const configured = process.env.WEBHARD_STORAGE_ROOT || process.env.WEBHARD_STORAGE_DIR || 'storage';
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

export function safePathSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return normalized || 'unknown';
}

function isProductionEnv(): boolean {
  const appEnv = String(process.env.APP_ENV || process.env.NODE_ENV || '').trim().toLowerCase();
  return appEnv === 'prod' || appEnv === 'production';
}
