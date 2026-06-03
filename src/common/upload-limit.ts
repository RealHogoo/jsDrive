export interface UploadLimits {
  maxFileBytes: number;
  maxTotalBytes: number;
}

const DEFAULT_MAX_FILE_MB = 2048;
const DEFAULT_MAX_TOTAL_MB = 4096;

export function uploadLimits(): UploadLimits {
  return {
    maxFileBytes: sizeEnv('WEBHARD_UPLOAD_MAX_FILE_BYTES', 'WEBHARD_UPLOAD_MAX_FILE_MB', DEFAULT_MAX_FILE_MB),
    maxTotalBytes: sizeEnv('WEBHARD_UPLOAD_MAX_TOTAL_BYTES', 'WEBHARD_UPLOAD_MAX_TOTAL_MB', DEFAULT_MAX_TOTAL_MB),
  };
}

function sizeEnv(bytesKey: string, mbKey: string, defaultMb: number): number {
  const bytes = numberEnv(bytesKey);
  if (bytes && bytes > 0) {
    return bytes;
  }
  const mb = numberEnv(mbKey) || defaultMb;
  return Math.floor(mb * 1024 * 1024);
}

function numberEnv(key: string): number | null {
  const value = process.env[key];
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
