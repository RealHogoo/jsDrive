import { isAbsolute, resolve } from 'path';

export function storageRoot(): string {
  const configured = process.env.WEBHARD_STORAGE_ROOT || process.env.WEBHARD_STORAGE_DIR || 'storage';
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

export function safePathSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return normalized || 'unknown';
}
