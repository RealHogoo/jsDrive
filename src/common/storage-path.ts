import { isAbsolute, resolve } from 'path';
import { accessSync, constants, statSync } from 'fs';

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

export interface StorageHealth {
  status: 'UP' | 'DOWN';
  root: string;
  readable: boolean;
  writable: boolean;
  error?: string;
}

export function storageHealth(): StorageHealth {
  const root = storageRoot();
  try {
    const stat = statSync(root);
    if (!stat.isDirectory()) {
      return {
        status: 'DOWN',
        root,
        readable: false,
        writable: false,
        error: 'storage root is not a directory',
      };
    }
    accessSync(root, constants.R_OK);
    accessSync(root, constants.W_OK);
    return {
      status: 'UP',
      root,
      readable: true,
      writable: true,
    };
  } catch (exception) {
    return {
      status: 'DOWN',
      root,
      readable: false,
      writable: false,
      error: storageErrorMessage(exception),
    };
  }
}

function isProductionEnv(): boolean {
  const appEnv = String(process.env.APP_ENV || process.env.NODE_ENV || '').trim().toLowerCase();
  return appEnv === 'prod' || appEnv === 'production';
}

function storageErrorMessage(exception: unknown): string {
  if (exception && typeof exception === 'object' && 'code' in exception) {
    return String((exception as { code?: unknown }).code || 'storage access failed');
  }
  return 'storage access failed';
}
