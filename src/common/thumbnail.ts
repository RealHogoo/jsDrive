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
): Promise<string | null> {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
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
    await runFfmpeg(ffmpeg, [
      '-y',
      '-ss',
      '00:00:01',
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

function thumbnailFileName(baseName: string, sourcePath: string): string {
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'file';
  const hash = createHash('sha1').update(sourcePath).digest('hex').slice(0, 12);
  return `${safeName}-${hash}.webp`;
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
