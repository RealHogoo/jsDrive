import { mkdir } from 'fs/promises';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { basename, dirname, extname, join } from 'path';
import sharp from 'sharp';
import { safePathSegment, storageRoot } from './storage-path';

export async function createImageThumbnail(
  sourcePath: string,
  ownerUserId: string,
  originalCreatedAt: string,
  sourceFileName: string,
): Promise<string | null> {
  try {
    const ownerDir = safePathSegment(ownerUserId);
    const date = new Date(originalCreatedAt);
    const yyyy = String(date.getUTCFullYear());
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const baseName = basename(sourceFileName, extname(sourceFileName));
    const name = thumbnailFileName(baseName, sourcePath);
    const targetPath = join(storageRoot(), ownerDir, '.thumbs', yyyy, mm, dd, name);
    await mkdir(dirname(targetPath), { recursive: true });
    await sharp(sourcePath)
      .rotate()
      .resize({ width: 420, height: 315, fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(targetPath);
    return targetPath;
  } catch {
    return null;
  }
}

export async function createVideoThumbnail(
  sourcePath: string,
  ownerUserId: string,
  originalCreatedAt: string,
  sourceFileName: string,
  seekSeconds = 1,
): Promise<string | null> {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  try {
    const normalizedSeekSeconds = normalizeSeekSeconds(seekSeconds);
    const ownerDir = safePathSegment(ownerUserId);
    const date = new Date(originalCreatedAt);
    const yyyy = String(date.getUTCFullYear());
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const baseName = basename(sourceFileName, extname(sourceFileName));
    const name = thumbnailFileName(baseName, sourcePath, `video-${normalizedSeekSeconds}`);
    const targetPath = join(storageRoot(), ownerDir, '.thumbs', yyyy, mm, dd, name);
    await mkdir(dirname(targetPath), { recursive: true });
    await runFfmpeg(ffmpeg, [
      '-y',
      '-ss',
      formatFfmpegSeek(normalizedSeekSeconds),
      '-i',
      sourcePath,
      '-frames:v',
      '1',
      '-vf',
      'scale=420:315:force_original_aspect_ratio=increase,crop=420:315',
      targetPath,
    ]);
    return targetPath;
  } catch {
    return null;
  }
}

function thumbnailFileName(baseName: string, sourcePath: string, variant = ''): string {
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'file';
  const hash = createHash('sha1').update(`${sourcePath}:${variant}`).digest('hex').slice(0, 12);
  return `${safeName}-${hash}.webp`;
}

function normalizeSeekSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(Math.max(Math.floor(value * 1000) / 1000, 0), 24 * 60 * 60);
}

function formatFfmpegSeek(totalSeconds: number): string {
  const wholeSeconds = Math.floor(totalSeconds);
  const milliseconds = Math.round((totalSeconds - wholeSeconds) * 1000);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = wholeSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

function runFfmpeg(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}
