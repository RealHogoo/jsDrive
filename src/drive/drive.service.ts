import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { ApiException } from '../common/api-exception';
import { safePathSegment, storageRoot } from '../common/storage-path';
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
             storage_path, public_path, original_created_at, created_at, updated_at
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

  async registerFile(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    await this.indexingService.ensureNotRunning(viewer);
    const folderId = optionalNumber(params.folder_id, 'folder_id');
    const fileName = requiredText(params.file_name, 'file_name is required');
    const storagePath = requiredText(params.storage_path, 'storage_path is required');
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
    const folderId = optionalNumber(params.folder_id, 'folder_id');
    const originalCreatedAt = optionalTimestamp(params.original_created_at, 'original_created_at') || new Date().toISOString();
    const contentType = file.mimetype || 'application/octet-stream';
    const contentKind = contentKindFor(contentType, file.originalname);
    if (contentKind === 'OTHER') {
      throw ApiException.badRequest('only image and video files can be uploaded');
    }

    const stored = await saveUploadedFile(file, originalCreatedAt, viewer.userId);
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
      [
        viewer.userId,
        folderId,
        file.originalname,
        file.size,
        contentType,
        contentKind,
        stored.storagePath,
        stored.publicPath,
        originalCreatedAt,
      ],
    );
    return {
      file_id: result.rows[0]?.file_id,
      public_path: stored.publicPath,
      original_created_at: originalCreatedAt,
      content_kind: contentKind,
    };
  }

  async previewList(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const periodType = normalizePeriodType(params.period_type);
    const baseDate = optionalDateOnly(params.base_date) || today();
    const contentKind = optionalContentKind(params.content_kind);
    const range = periodRange(periodType, baseDate);

    const result = await this.databaseService.query(
      `
      SELECT file_id, folder_id, file_name, file_size, content_type, content_kind,
             public_path, original_created_at, created_at
      FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'N'
        AND original_created_at >= CAST($2 AS timestamp)
        AND original_created_at < CAST($3 AS timestamp)
        AND ($4::varchar IS NULL OR content_kind = $4)
      ORDER BY original_created_at DESC, file_id DESC
      `,
      [viewer.userId, range.start, range.end, contentKind],
    );
    return {
      period_type: periodType,
      base_date: baseDate,
      start_date: range.start,
      end_date: range.end,
      items: result.rows,
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

function contentKindFor(contentType: string, fileName: string): 'IMAGE' | 'VIDEO' | 'OTHER' {
  const lowerType = contentType.toLowerCase();
  const lowerName = fileName.toLowerCase();
  if (lowerType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|heic)$/.test(lowerName)) {
    return 'IMAGE';
  }
  if (lowerType.startsWith('video/') || /\.(mp4|mov|m4v|avi|mkv|webm)$/.test(lowerName)) {
    return 'VIDEO';
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
  if (normalized === 'IMAGE' || normalized === 'VIDEO') {
    return normalized;
  }
  throw ApiException.badRequest('content_kind must be IMAGE or VIDEO');
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

async function saveUploadedFile(
  file: Express.Multer.File,
  originalCreatedAt: string,
  ownerUserId: string,
): Promise<{ storagePath: string; publicPath: string }> {
  const root = storageRoot();
  const ownerDir = safePathSegment(ownerUserId);
  const date = new Date(originalCreatedAt);
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const ext = extname(file.originalname).toLowerCase();
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
  };
}
