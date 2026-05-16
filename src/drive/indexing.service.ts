import { HttpStatus, Injectable } from '@nestjs/common';
import { readdir, stat } from 'fs/promises';
import { basename, extname, join } from 'path';
import { ApiCode } from '../common/api-code';
import { ApiException } from '../common/api-exception';
import { safePathSegment, storageRoot } from '../common/storage-path';
import { createImageThumbnail, createVideoThumbnail } from '../common/thumbnail';
import { DatabaseService } from '../database/database.service';
import type { Viewer } from './drive.service';

@Injectable()
export class IndexingService {
  constructor(private readonly databaseService: DatabaseService) {}

  async ensureNotRunning(viewer: Viewer): Promise<void> {
    const running = await this.runningJob(viewer.userId);
    if (running) {
      throw new ApiException(ApiCode.SERVER_ERROR, HttpStatus.CONFLICT, 'indexing is running');
    }
  }

  async start(viewer: Viewer): Promise<Record<string, unknown>> {
    const running = await this.runningJob(viewer.userId);
    if (running) {
      return running;
    }

    const ownerDir = safePathSegment(viewer.userId);
    const rootPath = join(storageRoot(), ownerDir);
    const result = await this.databaseService.query<{ job_id: number }>(
      `
      INSERT INTO wh_index_job (
        owner_user_id, root_path, status_cd, message, created_by, updated_by
      ) VALUES (
        $1, $2, 'RUNNING', 'indexing started', $1, $1
      )
      RETURNING job_id
      `,
      [viewer.userId, rootPath],
    );
    const jobId = result.rows[0]?.job_id;
    void this.run(jobId, viewer.userId, rootPath);
    return this.status(viewer);
  }

  async status(viewer: Viewer): Promise<Record<string, unknown>> {
    const result = await this.databaseService.query(
      `
      SELECT job_id, owner_user_id, root_path, status_cd, total_count, indexed_count,
             skipped_count, error_count, message, started_at, finished_at, updated_at
      FROM wh_index_job
      WHERE owner_user_id = $1
      ORDER BY job_id DESC
      LIMIT 1
      `,
      [viewer.userId],
    );
    return result.rows[0] || { status_cd: 'IDLE' };
  }

  private async runningJob(ownerUserId: string): Promise<Record<string, unknown> | null> {
    const result = await this.databaseService.query(
      `
      SELECT job_id, owner_user_id, root_path, status_cd, total_count, indexed_count,
             skipped_count, error_count, message, started_at, updated_at
      FROM wh_index_job
      WHERE owner_user_id = $1
        AND status_cd = 'RUNNING'
      ORDER BY job_id DESC
      LIMIT 1
      `,
      [ownerUserId],
    );
    return result.rows[0] || null;
  }

  private async run(jobId: number | undefined, ownerUserId: string, rootPath: string): Promise<void> {
    if (!jobId) {
      return;
    }
    let totalCount = 0;
    let indexedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    try {
      for await (const filePath of walk(rootPath)) {
        totalCount++;
        const fileName = basename(filePath);
        const contentKind = contentKindFor(fileName);
        if (contentKind === 'OTHER') {
          skippedCount++;
          await this.updateProgress(jobId, totalCount, indexedCount, skippedCount, errorCount, 'skipping unsupported files');
          continue;
        }
        try {
          const info = await stat(filePath);
          const publicPath = publicPathFor(rootPath, ownerUserId, filePath);
          const exists = await this.databaseService.query<{ file_id: number; thumbnail_path: string | null }>(
            `
            SELECT file_id, thumbnail_path
            FROM wh_file
            WHERE owner_user_id = $1
              AND storage_path = $2
              AND deleted_yn = 'N'
            LIMIT 1
            `,
            [ownerUserId, filePath],
          );
          if ((exists.rowCount || 0) > 0) {
            const existing = exists.rows[0];
            if ((contentKind === 'IMAGE' || contentKind === 'VIDEO') && !existing.thumbnail_path) {
              const originalCreatedAt = info.birthtime && !Number.isNaN(info.birthtime.getTime())
                ? info.birthtime.toISOString()
                : info.mtime.toISOString();
              const thumbnailPath = await createThumbnail(contentKind, filePath, ownerUserId, originalCreatedAt, fileName);
              if (thumbnailPath) {
                await this.databaseService.query(
                  `
                  UPDATE wh_file
                  SET thumbnail_path = $2,
                      updated_at = CURRENT_TIMESTAMP,
                      updated_by = $3
                  WHERE file_id = $1
                  `,
                  [existing.file_id, thumbnailPath, ownerUserId],
                );
              }
            }
            skippedCount++;
          } else {
            const originalCreatedAt = info.birthtime && !Number.isNaN(info.birthtime.getTime())
              ? info.birthtime.toISOString()
              : info.mtime.toISOString();
            const thumbnailPath = await createThumbnail(contentKind, filePath, ownerUserId, originalCreatedAt, fileName);
            await this.databaseService.query(
              `
              INSERT INTO wh_file (
                owner_user_id, folder_id, file_name, file_size, content_type, content_kind,
                storage_path, public_path, thumbnail_path, original_created_at, created_by, updated_by
              ) VALUES (
                $1, NULL, $2, $3, $4, $5, $6, $7, $8, CAST($9 AS timestamp), $1, $1
              )
              `,
              [
                ownerUserId,
                fileName,
                info.size,
                contentTypeFor(fileName, contentKind),
                contentKind,
                filePath,
                publicPath,
                thumbnailPath,
                originalCreatedAt,
              ],
            );
            indexedCount++;
          }
        } catch {
          errorCount++;
        }
        await this.updateProgress(jobId, totalCount, indexedCount, skippedCount, errorCount, 'indexing files');
      }
      await this.finish(jobId, 'DONE', totalCount, indexedCount, skippedCount, errorCount, 'indexing completed');
    } catch {
      await this.finish(jobId, 'FAILED', totalCount, indexedCount, skippedCount, errorCount, 'indexing failed');
    }
  }

  private async updateProgress(
    jobId: number,
    totalCount: number,
    indexedCount: number,
    skippedCount: number,
    errorCount: number,
    message: string,
  ): Promise<void> {
    await this.databaseService.query(
      `
      UPDATE wh_index_job
      SET total_count = $2,
          indexed_count = $3,
          skipped_count = $4,
          error_count = $5,
          message = $6,
          updated_at = CURRENT_TIMESTAMP
      WHERE job_id = $1
      `,
      [jobId, totalCount, indexedCount, skippedCount, errorCount, message],
    );
  }

  private async finish(
    jobId: number,
    status: 'DONE' | 'FAILED',
    totalCount: number,
    indexedCount: number,
    skippedCount: number,
    errorCount: number,
    message: string,
  ): Promise<void> {
    await this.databaseService.query(
      `
      UPDATE wh_index_job
      SET status_cd = $2,
          total_count = $3,
          indexed_count = $4,
          skipped_count = $5,
          error_count = $6,
          message = $7,
          finished_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE job_id = $1
      `,
      [jobId, status, totalCount, indexedCount, skippedCount, errorCount, message],
    );
  }
}

async function* walk(rootPath: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function contentKindFor(fileName: string): 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'OTHER' {
  const lowerName = fileName.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|bmp|heic)$/.test(lowerName)) {
    return 'IMAGE';
  }
  if (/\.(mp4|mov|m4v|avi|mkv|webm)$/.test(lowerName)) {
    return 'VIDEO';
  }
  if (/\.(pdf|xls|xlsx|csv|ods|doc|docx|ppt|pptx|txt|md|rtf|hwp|hwpx)$/.test(lowerName)) {
    return 'DOCUMENT';
  }
  return 'OTHER';
}

function contentTypeFor(fileName: string, contentKind: 'IMAGE' | 'VIDEO' | 'DOCUMENT'): string {
  const ext = extname(fileName).toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.heic': 'image/heic',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.pdf': 'application/pdf',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.csv': 'text/csv',
    '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.rtf': 'application/rtf',
    '.hwp': 'application/x-hwp',
    '.hwpx': 'application/x-hwpx',
  };
  if (map[ext]) {
    return map[ext];
  }
  if (contentKind === 'IMAGE') {
    return 'image/*';
  }
  if (contentKind === 'VIDEO') {
    return 'video/*';
  }
  return 'application/octet-stream';
}

async function createThumbnail(
  contentKind: string,
  filePath: string,
  ownerUserId: string,
  originalCreatedAt: string,
  fileName: string,
): Promise<string | null> {
  if (contentKind === 'IMAGE') {
    return createImageThumbnail(filePath, ownerUserId, originalCreatedAt, fileName);
  }
  if (contentKind === 'VIDEO') {
    return createVideoThumbnail(filePath, ownerUserId, originalCreatedAt, fileName);
  }
  return null;
}

function publicPathFor(rootPath: string, ownerUserId: string, filePath: string): string {
  const relative = filePath.slice(rootPath.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
  return `/storage/${safePathSegment(ownerUserId)}/${relative}`;
}
