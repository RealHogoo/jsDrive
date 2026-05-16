import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { ApiException } from '../common/api-exception';
import { safePathSegment, storageRoot } from '../common/storage-path';
import { createImageThumbnail, createVideoThumbnail } from '../common/thumbnail';
import { uploadLimits } from '../common/upload-limit';
import { DatabaseService } from '../database/database.service';
import { IndexingService } from './indexing.service';

export interface Viewer {
  userId: string;
  roles: string[];
}

@Injectable()
export class DriveService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly indexingService: IndexingService,
  ) {}

  async folderList(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const parentFolderId = optionalNumber(params.parent_folder_id, 'parent_folder_id');
    const result = await this.databaseService.query(
      `
      SELECT folder_id, parent_folder_id, folder_name, created_at, updated_at
      FROM wh_folder
      WHERE owner_user_id = $1
        AND (($2::bigint IS NULL AND parent_folder_id IS NULL) OR parent_folder_id = $2::bigint)
        AND deleted_yn = 'N'
      ORDER BY folder_name ASC, folder_id ASC
      `,
      [viewer.userId, parentFolderId],
    );
    return { items: result.rows };
  }

  async saveFolder(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const folderId = optionalNumber(params.folder_id, 'folder_id');
    const parentFolderId = optionalNumber(params.parent_folder_id, 'parent_folder_id');
    const folderName = requiredText(params.folder_name, 'folder_name is required');

    if (folderId == null) {
      const result = await this.databaseService.query<{ folder_id: number }>(
        `
        INSERT INTO wh_folder (owner_user_id, parent_folder_id, folder_name, created_by, updated_by)
        VALUES ($1, $2, $3, $1, $1)
        RETURNING folder_id
        `,
        [viewer.userId, parentFolderId, folderName],
      );
      return { folder_id: result.rows[0]?.folder_id };
    }

    const result = await this.databaseService.query<{ folder_id: number }>(
      `
      UPDATE wh_folder
      SET parent_folder_id = $2,
          folder_name = $3,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $1
      WHERE folder_id = $4
        AND owner_user_id = $1
        AND deleted_yn = 'N'
      RETURNING folder_id
      `,
      [viewer.userId, parentFolderId, folderName, folderId],
    );
    if (result.rowCount === 0) {
      throw ApiException.badRequest('folder not found');
    }
    return { folder_id: result.rows[0]?.folder_id };
  }

  async fileList(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const folderId = optionalNumber(params.folder_id, 'folder_id');
    const result = await this.databaseService.query(
      `
      SELECT file_id, folder_id, file_name, file_size, content_type, content_kind,
             storage_path, public_path, thumbnail_path, original_created_at, created_at, updated_at
      FROM wh_file
      WHERE owner_user_id = $1
        AND (($2::bigint IS NULL AND folder_id IS NULL) OR folder_id = $2::bigint)
        AND deleted_yn = 'N'
      ORDER BY file_name ASC, file_id ASC
      `,
      [viewer.userId, folderId],
    );
    return { items: result.rows };
  }

  async fileDetail(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const fileId = optionalNumber(params.file_id, 'file_id');
    if (fileId == null) {
      throw ApiException.badRequest('file_id is required');
    }
    const result = await this.databaseService.query(
      `
      SELECT file_id, folder_id, file_name, file_size, content_type, content_kind,
             public_path, thumbnail_path, original_created_at, created_at, updated_at
      FROM wh_file
      WHERE file_id = $1
        AND owner_user_id = $2
        AND deleted_yn = 'N'
      `,
      [fileId, viewer.userId],
    );
    if (result.rowCount === 0) {
      throw ApiException.badRequest('file not found');
    }
    return result.rows[0];
  }

  async deleteFile(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const fileId = requiredNumber(params.file_id, 'file_id is required');
    const result = await this.databaseService.query<{ file_id: number }>(
      `
      UPDATE wh_file
      SET deleted_yn = 'Y',
          deleted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $2
      WHERE file_id = $1
        AND owner_user_id = $2
        AND deleted_yn = 'N'
      RETURNING file_id
      `,
      [fileId, viewer.userId],
    );
    if (result.rowCount === 0) {
      throw ApiException.badRequest('file not found');
    }
    return { file_id: result.rows[0]?.file_id };
  }

  async trashList(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const offset = optionalNumber(params.offset, 'offset') || 0;
    const limit = Math.min(Math.max(optionalNumber(params.limit, 'limit') || 20, 1), 100);
    const result = await this.databaseService.query(
      `
      SELECT file_id, folder_id, file_name, file_size, content_type, content_kind,
             thumbnail_path, original_created_at, created_at, deleted_at
      FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'Y'
      ORDER BY deleted_at DESC NULLS LAST, file_id DESC
      LIMIT $2 OFFSET $3
      `,
      [viewer.userId, limit + 1, offset],
    );
    const rows = result.rows.slice(0, limit);
    return {
      items: rows,
      offset,
      limit,
      next_offset: offset + rows.length,
      has_more: result.rows.length > limit,
    };
  }

  async restoreFile(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const fileId = requiredNumber(params.file_id, 'file_id is required');
    const result = await this.databaseService.query<{ file_id: number }>(
      `
      UPDATE wh_file
      SET deleted_yn = 'N',
          deleted_at = NULL,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $2
      WHERE file_id = $1
        AND owner_user_id = $2
        AND deleted_yn = 'Y'
      RETURNING file_id
      `,
      [fileId, viewer.userId],
    );
    if (result.rowCount === 0) {
      throw ApiException.badRequest('file not found');
    }
    return { file_id: result.rows[0]?.file_id };
  }

  async purgeFile(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const fileId = requiredNumber(params.file_id, 'file_id is required');
    const result = await this.databaseService.query<{
      file_id: number;
      storage_path: string;
      thumbnail_path: string | null;
    }>(
      `
      DELETE FROM wh_file
      WHERE file_id = $1
        AND owner_user_id = $2
        AND deleted_yn = 'Y'
      RETURNING file_id, storage_path, thumbnail_path
      `,
      [fileId, viewer.userId],
    );
    const file = result.rows[0];
    if (!file) {
      throw ApiException.badRequest('file not found');
    }
    await removeFileIfExists(file.storage_path);
    if (file.thumbnail_path) {
      await removeFileIfExists(file.thumbnail_path);
    }
    return { file_id: file.file_id };
  }

  async purgeOldTrash(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const retentionDays = Math.min(Math.max(optionalNumber(params.retention_days, 'retention_days') || trashRetentionDays(), 1), 3650);
    const result = await this.databaseService.query<{
      file_id: number;
      storage_path: string;
      thumbnail_path: string | null;
    }>(
      `
      DELETE FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'Y'
        AND deleted_at < CURRENT_TIMESTAMP - ($2::int * INTERVAL '1 day')
      RETURNING file_id, storage_path, thumbnail_path
      `,
      [viewer.userId, retentionDays],
    );
    for (const file of result.rows) {
      await removeFileIfExists(file.storage_path);
      if (file.thumbnail_path) {
        await removeFileIfExists(file.thumbnail_path);
      }
    }
    return { retention_days: retentionDays, purged_count: result.rowCount || 0 };
  }

  async searchFiles(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const keyword = optionalText(params.keyword);
    const contentKind = optionalContentKind(params.content_kind);
    const sortBasis = normalizeSortBasis(params.sort_basis);
    const dateColumn = sortBasisDateColumn(sortBasis);
    const dateFrom = optionalDateOnly(params.date_from);
    const dateTo = optionalDateOnly(params.date_to);
    const offset = optionalNumber(params.offset, 'offset') || 0;
    const limit = Math.min(Math.max(optionalNumber(params.limit, 'limit') || 20, 1), 100);
    const dateToExclusive = dateTo ? nextDate(dateTo) : null;

    const result = await this.databaseService.query(
      `
      SELECT file_id, folder_id, file_name, file_size, content_type, content_kind,
             public_path, thumbnail_path, original_created_at, created_at
      FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'N'
        AND ($2::varchar IS NULL OR lower(file_name) LIKE '%' || lower($2) || '%')
        AND ($3::varchar IS NULL OR content_kind = $3)
        AND ($4::timestamp IS NULL OR ${dateColumn} >= $4::timestamp)
        AND ($5::timestamp IS NULL OR ${dateColumn} < $5::timestamp)
      ORDER BY ${dateColumn} DESC, file_id DESC
      LIMIT $6 OFFSET $7
      `,
      [viewer.userId, keyword, contentKind, dateFrom, dateToExclusive, limit + 1, offset],
    );
    const rows = result.rows.slice(0, limit);
    return {
      items: rows,
      offset,
      limit,
      next_offset: offset + rows.length,
      has_more: result.rows.length > limit,
      sort_basis: sortBasis,
    };
  }

  async rebuildThumbnails(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const limit = Math.min(Math.max(optionalNumber(params.limit, 'limit') || 50, 1), 200);
    const result = await this.databaseService.query<{
      file_id: number;
      file_name: string;
      storage_path: string;
      content_kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'OTHER';
      original_created_at: string;
    }>(
      `
      SELECT file_id, file_name, storage_path, content_kind, original_created_at
      FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'N'
        AND content_kind IN ('IMAGE', 'VIDEO')
        AND thumbnail_path IS NULL
      ORDER BY file_id ASC
      LIMIT $2
      `,
      [viewer.userId, limit],
    );
    let updated = 0;
    for (const file of result.rows) {
      if (!file.storage_path || !existsSync(file.storage_path)) {
        continue;
      }
      const thumbnailPath = await createThumbnail(
        file.content_kind,
        file.storage_path,
        viewer.userId,
        file.original_created_at || new Date().toISOString(),
        file.file_name,
      );
      if (!thumbnailPath) {
        continue;
      }
      await this.databaseService.query(
        `
        UPDATE wh_file
        SET thumbnail_path = $2,
            updated_at = CURRENT_TIMESTAMP,
            updated_by = $3
        WHERE file_id = $1
        `,
        [file.file_id, thumbnailPath, viewer.userId],
      );
      updated++;
    }
    return { scanned_count: result.rowCount || 0, updated_count: updated, has_more: (result.rowCount || 0) === limit };
  }

  async registerFile(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    await this.indexingService.ensureNotRunning(viewer);
    const folderId = optionalNumber(params.folder_id, 'folder_id');
    const fileName = requiredText(params.file_name, 'file_name is required');
    const storagePath = validateOwnedStoragePath(requiredText(params.storage_path, 'storage_path is required'), viewer.userId);
    const fileSize = optionalNumber(params.file_size, 'file_size') || 0;
    const contentType = optionalText(params.content_type) || 'application/octet-stream';
    const contentKind = contentKindFor(contentType, fileName);
    const originalCreatedAt = optionalTimestamp(params.original_created_at, 'original_created_at');

    const result = await this.databaseService.query<{ file_id: number }>(
      `
      INSERT INTO wh_file (
        owner_user_id, folder_id, file_name, file_size, content_type, content_kind,
        storage_path, public_path, original_created_at, created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, CAST($9 AS timestamp), $1, $1
      )
      RETURNING file_id
      `,
      [viewer.userId, folderId, fileName, fileSize, contentType, contentKind, storagePath, null, originalCreatedAt],
    );
    return { file_id: result.rows[0]?.file_id };
  }

  async uploadFile(
    params: Record<string, unknown>,
    file: Express.Multer.File | undefined,
    viewer: Viewer,
  ): Promise<Record<string, unknown>> {
    await this.indexingService.ensureNotRunning(viewer);
    if (!file) {
      throw ApiException.badRequest('file is required');
    }
    validateUploadSizes([file]);
    const folderId = optionalNumber(params.folder_id, 'folder_id');
    const originalCreatedAt = optionalTimestamp(params.original_created_at, 'original_created_at') || new Date().toISOString();
    const contentType = file.mimetype || 'application/octet-stream';
    const fileName = normalizeFileName(file.originalname);
    const contentKind = contentKindFor(contentType, fileName);
    if (contentKind === 'OTHER') {
      throw ApiException.badRequest('image, video, and document files can be uploaded');
    }

    const stored = await saveUploadedFile(file, originalCreatedAt, viewer.userId, fileName);
    const thumbnailPath = await createThumbnail(contentKind, stored.storagePath, viewer.userId, originalCreatedAt, stored.storedName);
    const result = await this.databaseService.query<{ file_id: number }>(
      `
      INSERT INTO wh_file (
        owner_user_id, folder_id, file_name, file_size, content_type, content_kind,
        storage_path, public_path, thumbnail_path, original_created_at, created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, CAST($10 AS timestamp), $1, $1
      )
      RETURNING file_id
      `,
      [
        viewer.userId,
        folderId,
        fileName,
        file.size,
        contentType,
        contentKind,
        stored.storagePath,
        stored.publicPath,
        thumbnailPath,
        originalCreatedAt,
      ],
    );
    return {
      file_id: result.rows[0]?.file_id,
      public_path: stored.publicPath,
      original_created_at: originalCreatedAt,
      content_kind: contentKind,
      thumbnail_path: thumbnailPath,
    };
  }

  async uploadFiles(
    params: Record<string, unknown>,
    files: Express.Multer.File[] | undefined,
    viewer: Viewer,
  ): Promise<Record<string, unknown>> {
    await this.indexingService.ensureNotRunning(viewer);
    const uploadFiles = files || [];
    if (uploadFiles.length === 0) {
      throw ApiException.badRequest('files are required');
    }
    validateUploadSizes(uploadFiles);
    const folderId = optionalNumber(params.folder_id, 'folder_id');
    const originalCreatedAtList = arrayParam(params.original_created_at);

    const items = [];
    for (let index = 0; index < uploadFiles.length; index++) {
      const file = uploadFiles[index];
      const fileName = normalizeFileName(file.originalname);
      const contentType = file.mimetype || 'application/octet-stream';
      const contentKind = contentKindFor(contentType, fileName);
      if (contentKind === 'OTHER') {
        throw ApiException.badRequest('image, video, and document files can be uploaded');
      }
      const originalCreatedAt = optionalTimestamp(originalCreatedAtList[index], 'original_created_at')
        || new Date().toISOString();
      const stored = await saveUploadedFile(file, originalCreatedAt, viewer.userId, fileName);
      const thumbnailPath = await createThumbnail(contentKind, stored.storagePath, viewer.userId, originalCreatedAt, stored.storedName);
      const result = await this.databaseService.query<{ file_id: number }>(
        `
        INSERT INTO wh_file (
          owner_user_id, folder_id, file_name, file_size, content_type, content_kind,
          storage_path, public_path, thumbnail_path, original_created_at, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, CAST($10 AS timestamp), $1, $1
        )
        RETURNING file_id
        `,
        [
          viewer.userId,
          folderId,
          fileName,
          file.size,
          contentType,
          contentKind,
          stored.storagePath,
          stored.publicPath,
          thumbnailPath,
          originalCreatedAt,
        ],
      );
      items.push({
        file_id: result.rows[0]?.file_id,
        file_name: fileName,
        public_path: stored.publicPath,
        original_created_at: originalCreatedAt,
        content_kind: contentKind,
        thumbnail_path: thumbnailPath,
      });
    }

    return { items, count: items.length };
  }

  async previewList(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const periodType = normalizePeriodType(params.period_type);
    const baseDate = optionalDateOnly(params.base_date) || today();
    const contentKind = optionalContentKind(params.content_kind);
    const sortBasis = normalizeSortBasis(params.sort_basis);
    const dateColumn = sortBasisDateColumn(sortBasis);
    const range = periodRange(periodType, baseDate);

    const result = await this.databaseService.query(
      `
      SELECT file_id, folder_id, file_name, file_size, content_type, content_kind,
             public_path, thumbnail_path, original_created_at, created_at
      FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'N'
        AND ${dateColumn} >= CAST($2 AS timestamp)
        AND ${dateColumn} < CAST($3 AS timestamp)
        AND ($4::varchar IS NULL OR content_kind = $4)
      ORDER BY ${dateColumn} DESC, file_id DESC
      `,
      [viewer.userId, range.start, range.end, contentKind],
    );
    return {
      period_type: periodType,
      base_date: baseDate,
      start_date: range.start,
      end_date: range.end,
      sort_basis: sortBasis,
      items: result.rows,
    };
  }

  async previewFeed(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const weeks = optionalNumber(params.weeks, 'weeks') || 5;
    const safeWeeks = Math.min(Math.max(weeks, 1), 12);
    const cursorDate = optionalDateOnly(params.cursor_date) || today();
    const contentKind = optionalContentKind(params.content_kind);
    const sortBasis = normalizeSortBasis(params.sort_basis);
    const dateColumn = sortBasisDateColumn(sortBasis);
    const upperBound = nextWeekStart(cursorDate);
    const previewItemLimit = Math.min(Math.max(optionalNumber(params.preview_item_limit, 'preview_item_limit') || 20, 1), 50);

    const weekResult = await this.databaseService.query<{ week_start: string; item_count: string }>(
      `
      SELECT to_char(date_trunc('week', ${dateColumn})::date, 'YYYY-MM-DD') AS week_start,
             COUNT(*) AS item_count
      FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'N'
        AND ${dateColumn} < CAST($2 AS timestamp)
        AND ($3::varchar IS NULL OR content_kind = $3)
      GROUP BY date_trunc('week', ${dateColumn})::date
      ORDER BY week_start DESC
      LIMIT $4
      `,
      [viewer.userId, upperBound, contentKind, safeWeeks],
    );
    if (weekResult.rows.length === 0) {
      return {
        period_type: 'week',
        sort_basis: sortBasis,
        weeks: [],
        next_cursor_date: null,
        has_more: false,
      };
    }

    const newestWeekStart = dateOnlyToUtc(weekResult.rows[0].week_start);
    const oldestWeekStart = dateOnlyToUtc(weekResult.rows[weekResult.rows.length - 1].week_start);
    const newestWeekEnd = new Date(newestWeekStart);
    newestWeekEnd.setUTCDate(newestWeekEnd.getUTCDate() + 7);

    const itemResult = await this.databaseService.query(
      `
      WITH ranked AS (
        SELECT file_id, folder_id, file_name, file_size, content_type, content_kind,
               public_path, thumbnail_path, original_created_at, created_at,
               row_number() OVER (
                 PARTITION BY date_trunc('week', ${dateColumn})::date
                 ORDER BY ${dateColumn} DESC, file_id DESC
               ) AS rn
        FROM wh_file
        WHERE owner_user_id = $1
          AND deleted_yn = 'N'
          AND ${dateColumn} >= CAST($2 AS timestamp)
          AND ${dateColumn} < CAST($3 AS timestamp)
          AND ($4::varchar IS NULL OR content_kind = $4)
      )
      SELECT file_id, folder_id, file_name, file_size, content_type, content_kind,
             public_path, thumbnail_path, original_created_at, created_at
      FROM ranked
      WHERE rn <= $5
      ORDER BY ${dateColumn} DESC, file_id DESC
      `,
      [viewer.userId, oldestWeekStart.toISOString(), newestWeekEnd.toISOString(), contentKind, previewItemLimit],
    );

    return {
      period_type: 'week',
      sort_basis: sortBasis,
      preview_item_limit: previewItemLimit,
      weeks: buildExistingWeeks(weekResult.rows, itemResult.rows, sortBasis),
      start_date: oldestWeekStart.toISOString(),
      end_date: newestWeekEnd.toISOString(),
      next_cursor_date: previousDate(toDateOnly(oldestWeekStart)),
      has_more: weekResult.rows.length === safeWeeks,
    };
  }

  async previewWeekItems(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const weekStart = optionalDateOnly(params.week_start);
    if (!weekStart) {
      throw ApiException.badRequest('week_start is required');
    }
    const contentKind = optionalContentKind(params.content_kind);
    const sortBasis = normalizeSortBasis(params.sort_basis);
    const dateColumn = sortBasisDateColumn(sortBasis);
    const offset = optionalNumber(params.offset, 'offset') || 0;
    const limit = Math.min(Math.max(optionalNumber(params.limit, 'limit') || 10, 1), 50);
    const start = startOfWeek(new Date(`${weekStart}T00:00:00.000Z`));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);

    const result = await this.databaseService.query(
      `
      SELECT file_id, folder_id, file_name, file_size, content_type, content_kind,
             public_path, thumbnail_path, original_created_at, created_at
      FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'N'
        AND ${dateColumn} >= CAST($2 AS timestamp)
        AND ${dateColumn} < CAST($3 AS timestamp)
        AND ($4::varchar IS NULL OR content_kind = $4)
      ORDER BY ${dateColumn} DESC, file_id DESC
      LIMIT $5 OFFSET $6
      `,
      [viewer.userId, start.toISOString(), end.toISOString(), contentKind, limit + 1, offset],
    );
    const rows = result.rows.slice(0, limit);

    return {
      week_start: start.toISOString(),
      week_end: end.toISOString(),
      label: `${toDateOnly(start)} ~ ${previousDate(toDateOnly(end))}`,
      sort_basis: sortBasis,
      items: rows,
      offset,
      limit,
      next_offset: offset + rows.length,
      has_more: result.rows.length > limit,
    };
  }

  uploadLimitInfo(): Record<string, unknown> {
    const limits = uploadLimits();
    return {
      max_file_bytes: limits.maxFileBytes,
      max_total_bytes: limits.maxTotalBytes,
    };
  }

  async createShare(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const fileId = optionalNumber(params.file_id, 'file_id');
    const folderId = optionalNumber(params.folder_id, 'folder_id');
    if (fileId == null && folderId == null) {
      throw ApiException.badRequest('file_id or folder_id is required');
    }
    const expiresAt = optionalText(params.expires_at);
    const result = await this.databaseService.query<{ share_id: number; share_token: string }>(
      `
      INSERT INTO wh_share (
        owner_user_id, folder_id, file_id, share_token, expires_at, created_by, updated_by
      ) VALUES (
        $1, $2, $3, encode(gen_random_bytes(24), 'hex'), CAST($4 AS timestamp), $1, $1
      )
      RETURNING share_id, share_token
      `,
      [viewer.userId, folderId, fileId, expiresAt],
    );
    return result.rows[0] || {};
  }
}

function requiredText(value: unknown, message: string): string {
  const text = optionalText(value);
  if (!text) {
    throw ApiException.badRequest(message);
  }
  return text;
}

function optionalText(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text ? text : null;
}

function optionalNumber(value: unknown, fieldName: string): number | null {
  const text = optionalText(value);
  if (!text) {
    return null;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    throw ApiException.badRequest(`${fieldName} must be numeric`);
  }
  return parsed;
}

function requiredNumber(value: unknown, message: string): number {
  const parsed = optionalNumber(value, 'file_id');
  if (parsed == null) {
    throw ApiException.badRequest(message);
  }
  return parsed;
}

function arrayParam(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  return [value];
}

function validateUploadSizes(files: Express.Multer.File[]): void {
  const limits = uploadLimits();
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const tooLarge = files.find((file) => file.size > limits.maxFileBytes);
  if (tooLarge) {
    throw ApiException.badRequest(`file size must be ${formatBytes(limits.maxFileBytes)} or less`);
  }
  if (totalSize > limits.maxTotalBytes) {
    throw ApiException.badRequest(`total upload size must be ${formatBytes(limits.maxTotalBytes)} or less`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${Math.floor(bytes / 1024 / 1024 / 1024)}GB`;
  }
  return `${Math.floor(bytes / 1024 / 1024)}MB`;
}

function contentKindFor(contentType: string, fileName: string): 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'OTHER' {
  const lowerType = contentType.toLowerCase();
  const lowerName = fileName.toLowerCase();
  if (lowerType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|heic)$/.test(lowerName)) {
    return 'IMAGE';
  }
  if (lowerType.startsWith('video/') || /\.(mp4|mov|m4v|avi|mkv|webm)$/.test(lowerName)) {
    return 'VIDEO';
  }
  if (
    lowerType === 'application/pdf'
    || lowerType.startsWith('text/')
    || lowerType.includes('msword')
    || lowerType.includes('ms-excel')
    || lowerType.includes('ms-powerpoint')
    || lowerType.includes('officedocument')
    || lowerType.includes('spreadsheet')
    || lowerType.includes('presentation')
    || lowerType.includes('wordprocessing')
    || lowerType.includes('haansoft')
    || /\.(pdf|xls|xlsx|csv|ods|doc|docx|ppt|pptx|txt|md|rtf|hwp|hwpx)$/.test(lowerName)
  ) {
    return 'DOCUMENT';
  }
  return 'OTHER';
}

function optionalTimestamp(value: unknown, fieldName: string): string | null {
  const text = optionalText(value);
  if (!text) {
    return null;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw ApiException.badRequest(`${fieldName} must be a valid datetime`);
  }
  return date.toISOString();
}

function optionalDateOnly(value: unknown): string | null {
  const text = optionalText(value);
  if (!text) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw ApiException.badRequest('base_date must be yyyy-MM-dd');
  }
  return text;
}

function normalizePeriodType(value: unknown): 'day' | 'week' | 'month' {
  const text = optionalText(value) || 'day';
  if (text === 'day' || text === 'week' || text === 'month') {
    return text;
  }
  throw ApiException.badRequest('period_type must be day, week, or month');
}

function optionalContentKind(value: unknown): string | null {
  const text = optionalText(value);
  if (!text || text === 'ALL') {
    return null;
  }
  const normalized = text.toUpperCase();
  if (normalized === 'IMAGE' || normalized === 'VIDEO' || normalized === 'DOCUMENT') {
    return normalized;
  }
  throw ApiException.badRequest('content_kind must be IMAGE, VIDEO, or DOCUMENT');
}

function normalizeSortBasis(value: unknown): 'ORIGINAL_CREATED' | 'UPLOADED' {
  const text = optionalText(value);
  if (!text || text === 'ORIGINAL_CREATED') {
    return 'ORIGINAL_CREATED';
  }
  const normalized = text.toUpperCase();
  if (normalized === 'UPLOADED' || normalized === 'CREATED_AT') {
    return 'UPLOADED';
  }
  throw ApiException.badRequest('sort_basis must be ORIGINAL_CREATED or UPLOADED');
}

function sortBasisDateColumn(sortBasis: 'ORIGINAL_CREATED' | 'UPLOADED'): string {
  return sortBasis === 'UPLOADED' ? 'created_at' : 'original_created_at';
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function periodRange(periodType: 'day' | 'week' | 'month', baseDate: string): { start: string; end: string } {
  const date = new Date(`${baseDate}T00:00:00.000Z`);
  const start = new Date(date);
  if (periodType === 'week') {
    const day = start.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setUTCDate(start.getUTCDate() + diff);
  }
  if (periodType === 'month') {
    start.setUTCDate(1);
  }
  const end = new Date(start);
  if (periodType === 'day') {
    end.setUTCDate(end.getUTCDate() + 1);
  } else if (periodType === 'week') {
    end.setUTCDate(end.getUTCDate() + 7);
  } else {
    end.setUTCMonth(end.getUTCMonth() + 1);
  }
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function startOfWeek(date: Date): Date {
  const start = new Date(date);
  const day = start.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setUTCDate(start.getUTCDate() + diff);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

function nextWeekStart(cursorDate: string): string {
  const start = startOfWeek(new Date(`${cursorDate}T00:00:00.000Z`));
  start.setUTCDate(start.getUTCDate() + 7);
  return start.toISOString();
}

function buildExistingWeeks(
  weeks: Array<{ week_start: string; item_count: string }>,
  items: Record<string, unknown>[],
  sortBasis: 'ORIGINAL_CREATED' | 'UPLOADED',
): Record<string, unknown>[] {
  return weeks.map((week) => {
    const start = dateOnlyToUtc(week.week_start);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const bucketItems = items.filter((item) => {
      const basisDate = optionalText(sortBasis === 'UPLOADED' ? item.created_at : item.original_created_at);
      if (!basisDate) {
        return false;
      }
      const itemDate = new Date(basisDate);
      return itemDate >= start && itemDate < end;
    });
    return {
      week_start: start.toISOString(),
      week_end: end.toISOString(),
      label: `${toDateOnly(start)} ~ ${previousDate(toDateOnly(end))}`,
      items: bucketItems,
      item_count: Number(week.item_count || 0),
    };
  });
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateOnlyToUtc(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

function previousDate(dateOnly: string): string {
  const date = dateOnlyToUtc(dateOnly);
  date.setUTCDate(date.getUTCDate() - 1);
  return toDateOnly(date);
}

function nextDate(dateOnly: string): string {
  const date = dateOnlyToUtc(dateOnly);
  date.setUTCDate(date.getUTCDate() + 1);
  return toDateOnly(date);
}

function trashRetentionDays(): number {
  const parsed = Number(process.env.WEBHARD_TRASH_RETENTION_DAYS || '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function validateOwnedStoragePath(storagePath: string, ownerUserId: string): string {
  const root = resolve(storageRoot(), safePathSegment(ownerUserId));
  const target = resolve(storagePath);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === '' || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw ApiException.badRequest('storage_path must be under the owner storage root');
  }
  return target;
}

async function saveUploadedFile(
  file: Express.Multer.File,
  originalCreatedAt: string,
  ownerUserId: string,
  fileName: string,
): Promise<{ storagePath: string; publicPath: string; storedName: string }> {
  const root = storageRoot();
  const ownerDir = safePathSegment(ownerUserId);
  const date = new Date(originalCreatedAt);
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const ext = extname(fileName).toLowerCase();
  const storedName = `${randomUUID()}${ext}`;
  const relativeDir = join(ownerDir, yyyy, mm, dd);
  const absoluteDir = join(root, relativeDir);
  await mkdir(absoluteDir, { recursive: true });
  const absolutePath = join(absoluteDir, storedName);
  await writeFile(absolutePath, file.buffer);
  const publicPath = `/storage/${ownerDir}/${yyyy}/${mm}/${dd}/${storedName}`;
  return {
    storagePath: absolutePath,
    publicPath,
    storedName,
  };
}

async function createThumbnail(
  contentKind: string,
  storagePath: string,
  ownerUserId: string,
  originalCreatedAt: string,
  fileName: string,
): Promise<string | null> {
  if (contentKind === 'IMAGE') {
    return createImageThumbnail(storagePath, ownerUserId, originalCreatedAt, fileName);
  }
  if (contentKind === 'VIDEO') {
    return createVideoThumbnail(storagePath, ownerUserId, originalCreatedAt, fileName);
  }
  return null;
}

async function removeFileIfExists(path: string): Promise<void> {
  if (path && existsSync(path)) {
    await unlink(path).catch(() => undefined);
  }
}

function normalizeFileName(fileName: string): string {
  const text = String(fileName || '').trim();
  if (!text) {
    return 'file';
  }
  if (!hasLatin1Mojibake(text) && !/\\u00[0-9a-fA-F]{2}/.test(text)) {
    return text;
  }
  try {
    const latin1Text = text.replace(/\\u00([0-9a-fA-F]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
    const decoded = Buffer.from(latin1Text, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? text : decoded;
  } catch {
    return text;
  }
}

function hasLatin1Mojibake(text: string): boolean {
  return [...text].some((char) => {
    const code = char.charCodeAt(0);
    return code >= 0x80 && code <= 0xff;
  });
}
