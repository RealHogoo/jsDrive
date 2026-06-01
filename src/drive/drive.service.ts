import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, scryptSync } from 'crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'path';
import sharp from 'sharp';
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

interface AuditDetail {
  target_type?: string;
  target_id?: number | null;
  detail?: Record<string, unknown>;
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

  async folderTree(viewer: Viewer): Promise<Record<string, unknown>> {
    const result = await this.databaseService.query(
      `
      WITH RECURSIVE folders AS (
        SELECT folder_id, parent_folder_id, folder_name, folder_name::text AS folder_path, 1 AS depth
        FROM wh_folder
        WHERE owner_user_id = $1
          AND parent_folder_id IS NULL
          AND deleted_yn = 'N'
        UNION ALL
        SELECT child.folder_id, child.parent_folder_id, child.folder_name,
               folders.folder_path || ' / ' || child.folder_name,
               folders.depth + 1
        FROM wh_folder child
        JOIN folders ON child.parent_folder_id = folders.folder_id
        WHERE child.owner_user_id = $1
          AND child.deleted_yn = 'N'
      )
      SELECT folder_id, parent_folder_id, folder_name, folder_path, depth
      FROM folders
      ORDER BY folder_path ASC, folder_id ASC
      `,
      [viewer.userId],
    );
    return { items: result.rows };
  }

  async saveFolder(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const folderId = optionalNumber(params.folder_id, 'folder_id');
    const parentFolderId = optionalNumber(params.parent_folder_id, 'parent_folder_id');
    const folderName = requiredText(params.folder_name, 'folder_name is required');
    await this.ensureOwnedFolder(parentFolderId, viewer);

    if (folderId == null) {
      const result = await this.databaseService.query<{ folder_id: number }>(
        `
        INSERT INTO wh_folder (owner_user_id, parent_folder_id, folder_name, created_by, updated_by)
        VALUES ($1, $2, $3, $1, $1)
        RETURNING folder_id
        `,
        [viewer.userId, parentFolderId, folderName],
      );
      const folder = { folder_id: result.rows[0]?.folder_id };
      await this.audit('FOLDER_CREATE', viewer, { target_type: 'FOLDER', target_id: folder.folder_id as number | null });
      return folder;
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
    const folder = { folder_id: result.rows[0]?.folder_id };
    await this.audit('FOLDER_UPDATE', viewer, { target_type: 'FOLDER', target_id: folder.folder_id as number | null });
    return folder;
  }

  async moveFolder(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const folderId = requiredNumber(params.folder_id, 'folder_id is required');
    const parentFolderId = optionalNumber(params.parent_folder_id, 'parent_folder_id');
    if (folderId === parentFolderId) {
      throw ApiException.badRequest('folder cannot be moved under itself');
    }
    const result = await this.databaseService.query<{ folder_id: number }>(
      `
      WITH RECURSIVE descendants AS (
        SELECT folder_id
        FROM wh_folder
        WHERE folder_id = $1
          AND owner_user_id = $2
        UNION ALL
        SELECT child.folder_id
        FROM wh_folder child
        JOIN descendants parent ON child.parent_folder_id = parent.folder_id
        WHERE child.owner_user_id = $2
      )
      UPDATE wh_folder
      SET parent_folder_id = $3,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $2
      WHERE folder_id = $1
        AND owner_user_id = $2
        AND deleted_yn = 'N'
        AND (
          $3::bigint IS NULL
          OR (
            $3::bigint NOT IN (SELECT folder_id FROM descendants)
            AND EXISTS (
              SELECT 1
              FROM wh_folder target
              WHERE target.folder_id = $3::bigint
                AND target.owner_user_id = $2
                AND target.deleted_yn = 'N'
            )
          )
        )
      RETURNING folder_id
      `,
      [folderId, viewer.userId, parentFolderId],
    );
    if (result.rowCount === 0) {
      throw ApiException.badRequest('folder not found or invalid target folder');
    }
    const folder = { folder_id: result.rows[0]?.folder_id, parent_folder_id: parentFolderId };
    await this.audit('FOLDER_MOVE', viewer, { target_type: 'FOLDER', target_id: folder.folder_id as number | null });
    return folder;
  }

  async fileList(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const folderId = optionalNumber(params.folder_id, 'folder_id');
    const result = await this.databaseService.query(
      `
      SELECT file_id, folder_id, file_name, display_name, file_size, content_type, content_kind,
             public_path, thumbnail_path, original_created_at, created_at, updated_at
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
      SELECT file_id, folder_id, file_name, display_name, memo, tags, file_size, content_type, content_kind,
             content_sha256, public_path, thumbnail_path, original_created_at, created_at, updated_at
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
    const file = result.rows[0] as Record<string, unknown>;
    const duplicateResult = await this.databaseService.query(
      `
      SELECT file_id, file_name, display_name, file_size, created_at
      FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'N'
        AND content_sha256 IS NOT NULL
        AND content_sha256 = $2
        AND file_id <> $3
      ORDER BY created_at DESC, file_id DESC
      LIMIT 10
      `,
      [viewer.userId, file.content_sha256 || null, fileId],
    );
    return { ...file, duplicates: duplicateResult.rows };
  }

  async updateFileMetadata(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const fileId = requiredNumber(params.file_id, 'file_id is required');
    const fileName = optionalText(params.file_name);
    const displayName = optionalText(params.display_name);
    const memo = optionalText(params.memo);
    const tags = normalizeTags(params.tags);
    const result = await this.databaseService.query(
      `
      UPDATE wh_file
      SET file_name = COALESCE($3, file_name),
          display_name = $4,
          memo = $5,
          tags = $6,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $2
      WHERE file_id = $1
        AND owner_user_id = $2
        AND deleted_yn = 'N'
      RETURNING file_id, file_name, display_name, memo, tags, updated_at
      `,
      [fileId, viewer.userId, fileName, displayName, memo, tags],
    );
    if (result.rowCount === 0) {
      throw ApiException.badRequest('file not found');
    }
    await this.audit('FILE_METADATA_UPDATE', viewer, { target_type: 'FILE', target_id: fileId });
    return result.rows[0];
  }

  async moveFile(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const fileId = requiredNumber(params.file_id, 'file_id is required');
    const folderId = optionalNumber(params.folder_id, 'folder_id');
    const result = await this.databaseService.query(
      `
      UPDATE wh_file
      SET folder_id = $3,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $2
      WHERE file_id = $1
        AND owner_user_id = $2
        AND deleted_yn = 'N'
        AND (
          $3::bigint IS NULL
          OR EXISTS (
            SELECT 1
            FROM wh_folder
            WHERE folder_id = $3::bigint
              AND owner_user_id = $2
              AND deleted_yn = 'N'
          )
        )
      RETURNING file_id, folder_id
      `,
      [fileId, viewer.userId, folderId],
    );
    if (result.rowCount === 0) {
      throw ApiException.badRequest('file not found or invalid target folder');
    }
    await this.audit('FILE_MOVE', viewer, { target_type: 'FILE', target_id: fileId });
    return result.rows[0];
  }

  async duplicates(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const minCount = Math.min(Math.max(optionalNumber(params.min_count, 'min_count') || 2, 2), 20);
    const result = await this.databaseService.query(
      `
      SELECT content_sha256,
             COUNT(*) AS file_count,
             SUM(file_size) AS total_bytes,
             MIN(file_size) AS file_size,
             MAX(updated_at) AS updated_at
      FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'N'
        AND content_sha256 IS NOT NULL
      GROUP BY content_sha256
      HAVING COUNT(*) >= $2
      ORDER BY total_bytes DESC, file_count DESC
      LIMIT 50
      `,
      [viewer.userId, minCount],
    );
    return { items: result.rows };
  }

  async backfillHashes(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const limit = Math.min(Math.max(optionalNumber(params.limit, 'limit') || 50, 1), 200);
    const includeAllUsers = isAdminViewer(viewer) && optionalBoolean(params.all_users);
    const result = await this.databaseService.query<{
      file_id: number;
      owner_user_id: string;
      storage_path: string;
    }>(
      `
      SELECT file_id, owner_user_id, storage_path
      FROM wh_file
      WHERE ($2::boolean OR owner_user_id = $1)
        AND deleted_yn = 'N'
        AND content_sha256 IS NULL
      ORDER BY file_id ASC
      LIMIT $3
      `,
      [viewer.userId, includeAllUsers, limit],
    );
    let updated = 0;
    let skipped = 0;
    for (const file of result.rows) {
      if (!file.storage_path || !existsSync(file.storage_path)) {
        skipped++;
        continue;
      }
      const hash = createHash('sha256').update(await readFile(file.storage_path)).digest('hex');
      await this.databaseService.query(
        `
        UPDATE wh_file
        SET content_sha256 = $2,
            updated_at = CURRENT_TIMESTAMP,
            updated_by = $3
        WHERE file_id = $1
        `,
        [file.file_id, hash, viewer.userId],
      );
      updated++;
    }
    return {
      scanned_count: result.rowCount || 0,
      updated_count: updated,
      skipped_count: skipped,
      has_more: (result.rowCount || 0) === limit,
    };
  }

  async dashboardSummary(_params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const includeAllUsers = isAdminViewer(viewer);
    const [totals, byKind, folders, duplicateGroups, recent, byOwner, todayUploads, shareSummary, recentAudit] = await Promise.all([
      this.databaseService.query(
        `
        SELECT COUNT(*) AS file_count,
               COALESCE(SUM(file_size), 0) AS total_bytes,
               COUNT(*) FILTER (WHERE deleted_yn = 'Y') AS trash_count,
               COALESCE(SUM(file_size) FILTER (WHERE deleted_yn = 'Y'), 0) AS trash_bytes
        FROM wh_file
        WHERE ($2::boolean OR owner_user_id = $1)
        `,
        [viewer.userId, includeAllUsers],
      ),
      this.databaseService.query(
        `
        SELECT content_kind, COUNT(*) AS file_count, COALESCE(SUM(file_size), 0) AS total_bytes
        FROM wh_file
        WHERE ($2::boolean OR owner_user_id = $1)
          AND deleted_yn = 'N'
        GROUP BY content_kind
        ORDER BY total_bytes DESC
        `,
        [viewer.userId, includeAllUsers],
      ),
      this.databaseService.query(
        `
        SELECT COUNT(*) AS folder_count
        FROM wh_folder
        WHERE ($2::boolean OR owner_user_id = $1)
          AND deleted_yn = 'N'
        `,
        [viewer.userId, includeAllUsers],
      ),
      this.databaseService.query(
        `
        SELECT COUNT(*) AS duplicate_group_count,
               COALESCE(SUM((file_count - 1) * file_size), 0) AS reclaimable_bytes
        FROM (
          SELECT content_sha256, COUNT(*) AS file_count, MIN(file_size) AS file_size
          FROM wh_file
          WHERE ($2::boolean OR owner_user_id = $1)
            AND deleted_yn = 'N'
            AND content_sha256 IS NOT NULL
          GROUP BY content_sha256
          HAVING COUNT(*) > 1
        ) dup
        `,
        [viewer.userId, includeAllUsers],
      ),
      this.databaseService.query(
        `
        SELECT owner_user_id, file_id, file_name, display_name, file_size, content_kind, created_at
        FROM wh_file
        WHERE ($2::boolean OR owner_user_id = $1)
          AND deleted_yn = 'N'
        ORDER BY created_at DESC, file_id DESC
        LIMIT 8
        `,
        [viewer.userId, includeAllUsers],
      ),
      includeAllUsers ? this.databaseService.query(
        `
        SELECT owner_user_id, COUNT(*) AS file_count, COALESCE(SUM(file_size), 0) AS total_bytes
        FROM wh_file
        WHERE deleted_yn = 'N'
        GROUP BY owner_user_id
        ORDER BY total_bytes DESC, file_count DESC
        LIMIT 20
        `,
      ) : Promise.resolve({ rows: [] }),
      this.databaseService.query(
        `
        SELECT COUNT(*) AS upload_count,
               COALESCE(SUM(file_size), 0) AS upload_bytes
        FROM wh_file
        WHERE ($2::boolean OR owner_user_id = $1)
          AND created_at >= CURRENT_DATE
          AND created_at < CURRENT_DATE + INTERVAL '1 day'
          AND deleted_yn = 'N'
        `,
        [viewer.userId, includeAllUsers],
      ),
      this.databaseService.query(
        `
        SELECT COUNT(*) AS share_count,
               COUNT(*) FILTER (
                 WHERE revoked_yn = 'N'
                   AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
                   AND (max_download_count IS NULL OR download_count < max_download_count)
               ) AS active_share_count
        FROM wh_share
        WHERE ($2::boolean OR owner_user_id = $1)
        `,
        [viewer.userId, includeAllUsers],
      ),
      this.databaseService.query(
        `
        SELECT log_id, actor_user_id, action_cd, target_type, target_id, created_at
        FROM wh_audit_log
        WHERE ($2::boolean OR actor_user_id = $1)
        ORDER BY log_id DESC
        LIMIT 5
        `,
        [viewer.userId, includeAllUsers],
      ).catch(() => ({ rows: [] })),
    ]);
    return {
      scope: includeAllUsers ? 'ALL_USERS' : 'CURRENT_USER',
      totals: totals.rows[0] || {},
      folders: folders.rows[0] || {},
      by_kind: byKind.rows,
      by_owner: byOwner.rows,
      duplicates: duplicateGroups.rows[0] || {},
      recent_files: recent.rows,
      today_uploads: todayUploads.rows[0] || {},
      shares: shareSummary.rows[0] || {},
      recent_audit: recentAudit.rows,
    };
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
    const file = { file_id: result.rows[0]?.file_id };
    await this.audit('FILE_DELETE', viewer, { target_type: 'FILE', target_id: file.file_id as number | null });
    return file;
  }

  async trashList(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const offset = optionalNumber(params.offset, 'offset') || 0;
    const limit = Math.min(Math.max(optionalNumber(params.limit, 'limit') || 20, 1), 100);
    const result = await this.databaseService.query(
      `
      SELECT file_id, folder_id, file_name, display_name, file_size, content_type, content_kind,
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
    const file = { file_id: result.rows[0]?.file_id };
    await this.audit('FILE_RESTORE', viewer, { target_type: 'FILE', target_id: file.file_id as number | null });
    return file;
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
    await this.audit('FILE_PURGE', viewer, { target_type: 'FILE', target_id: file.file_id });
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
    await this.audit('TRASH_PURGE_OLD', viewer, {
      detail: { retention_days: retentionDays, purged_count: result.rowCount || 0 },
    });
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
      SELECT file_id, folder_id, file_name, display_name, file_size, content_type, content_kind,
             public_path, thumbnail_path, original_created_at, created_at
      FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'N'
        AND (
          $2::varchar IS NULL
          OR lower(file_name) LIKE '%' || lower($2) || '%'
          OR lower(COALESCE(display_name, '')) LIKE '%' || lower($2) || '%'
          OR lower(COALESCE(tags, '')) LIKE '%' || lower($2) || '%'
        )
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
    await this.ensureOwnedFolder(folderId, viewer);
    const fileName = requiredText(params.file_name, 'file_name is required');
    const storagePath = validateOwnedStoragePath(requiredText(params.storage_path, 'storage_path is required'), viewer.userId);
    const fileSize = optionalNumber(params.file_size, 'file_size') || 0;
    const contentType = optionalText(params.content_type) || 'application/octet-stream';
    const contentKind = contentKindFor(contentType, fileName);
    const originalCreatedAt = optionalTimestamp(params.original_created_at, 'original_created_at');
    const contentSha256 = optionalText(params.content_sha256);

    const result = await this.databaseService.query<{ file_id: number }>(
      `
      INSERT INTO wh_file (
        owner_user_id, folder_id, file_name, file_size, content_type, content_kind,
        storage_path, public_path, original_created_at, content_sha256, created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, CAST($9 AS timestamp), $10, $1, $1
      )
      RETURNING file_id
      `,
      [viewer.userId, folderId, fileName, fileSize, contentType, contentKind, storagePath, null, originalCreatedAt, contentSha256],
    );
    const file = { file_id: result.rows[0]?.file_id };
    await this.audit('FILE_REGISTER', viewer, { target_type: 'FILE', target_id: file.file_id as number | null });
    return file;
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
    await this.ensureOwnedFolder(folderId, viewer);
    const originalCreatedAt = optionalTimestamp(params.original_created_at, 'original_created_at') || new Date().toISOString();
    const contentType = file.mimetype || 'application/octet-stream';
    const fileName = normalizeFileName(file.originalname);
    const contentKind = contentKindFor(contentType, fileName);
    if (contentKind === 'OTHER') {
      await removeTempUploadedFile(file);
      throw ApiException.badRequest('unsupported file type. image, video, and document files can be uploaded');
    }
    const contentSha256 = await fileHash(file);
    const detectedOriginalCreatedAt = await detectOriginalCreatedAt(file, originalCreatedAt, contentKind);

    const stored = await saveUploadedFile(file, detectedOriginalCreatedAt, viewer.userId, fileName);
    const thumbnailPath = await createThumbnail(contentKind, stored.storagePath, viewer.userId, detectedOriginalCreatedAt, stored.storedName);
    const duplicateInfo = await this.duplicateInfo(viewer.userId, contentSha256);
    const result = await this.databaseService.query<{ file_id: number }>(
      `
      INSERT INTO wh_file (
        owner_user_id, folder_id, file_name, file_size, content_type, content_kind,
        storage_path, public_path, thumbnail_path, original_created_at, content_sha256, created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, CAST($10 AS timestamp), $11, $1, $1
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
        detectedOriginalCreatedAt,
        contentSha256,
      ],
    );
    const uploaded = {
      file_id: result.rows[0]?.file_id,
      public_path: stored.publicPath,
      original_created_at: detectedOriginalCreatedAt,
      content_kind: contentKind,
      thumbnail_path: thumbnailPath,
      content_sha256: contentSha256,
      duplicate_count: duplicateInfo.count,
      duplicate_files: duplicateInfo.items,
    };
    await this.audit('FILE_UPLOAD', viewer, { target_type: 'FILE', target_id: uploaded.file_id as number | null });
    return uploaded;
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
    await this.ensureOwnedFolder(folderId, viewer);
    const originalCreatedAtList = arrayParam(params.original_created_at);

    const items = [];
    for (let index = 0; index < uploadFiles.length; index++) {
      const file = uploadFiles[index];
      const fileName = normalizeFileName(file.originalname);
      const contentType = file.mimetype || 'application/octet-stream';
      const contentKind = contentKindFor(contentType, fileName);
      if (contentKind === 'OTHER') {
        await removeTempUploadedFile(file);
        throw ApiException.badRequest('unsupported file type. image, video, and document files can be uploaded');
      }
      const requestedOriginalCreatedAt = optionalTimestamp(originalCreatedAtList[index], 'original_created_at')
        || new Date().toISOString();
      const originalCreatedAt = await detectOriginalCreatedAt(file, requestedOriginalCreatedAt, contentKind);
      const contentSha256 = await fileHash(file);
      const duplicateInfo = await this.duplicateInfo(viewer.userId, contentSha256);
      const stored = await saveUploadedFile(file, originalCreatedAt, viewer.userId, fileName);
      const thumbnailPath = await createThumbnail(contentKind, stored.storagePath, viewer.userId, originalCreatedAt, stored.storedName);
      const result = await this.databaseService.query<{ file_id: number }>(
        `
        INSERT INTO wh_file (
          owner_user_id, folder_id, file_name, file_size, content_type, content_kind,
          storage_path, public_path, thumbnail_path, original_created_at, content_sha256, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, CAST($10 AS timestamp), $11, $1, $1
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
          contentSha256,
        ],
      );
      items.push({
        file_id: result.rows[0]?.file_id,
        file_name: fileName,
        public_path: stored.publicPath,
        original_created_at: originalCreatedAt,
        content_kind: contentKind,
        thumbnail_path: thumbnailPath,
        content_sha256: contentSha256,
        duplicate_count: duplicateInfo.count,
        duplicate_files: duplicateInfo.items,
      });
      await this.audit('FILE_UPLOAD', viewer, { target_type: 'FILE', target_id: result.rows[0]?.file_id || null });
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
      SELECT file_id, folder_id, file_name, display_name, file_size, content_type, content_kind,
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
        SELECT file_id, folder_id, file_name, display_name, file_size, content_type, content_kind,
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
      SELECT file_id, folder_id, file_name, display_name, file_size, content_type, content_kind,
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
      SELECT file_id, folder_id, file_name, display_name, file_size, content_type, content_kind,
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
    if ((fileId == null && folderId == null) || (fileId != null && folderId != null)) {
      throw ApiException.badRequest('file_id or folder_id is required');
    }
    await this.ensureShareTarget(fileId, folderId, viewer);
    const expiresAt = optionalText(params.expires_at);
    const password = optionalText(params.password);
    const passwordHash = password ? hashPassword(password) : null;
    const maxDownloadCount = optionalNumber(params.max_download_count, 'max_download_count');
    const result = await this.databaseService.query<{ share_id: number; share_token: string }>(
      `
      INSERT INTO wh_share (
        owner_user_id, folder_id, file_id, share_token, password_hash,
        max_download_count, expires_at, created_by, updated_by
      ) VALUES (
        $1, $2, $3, encode(gen_random_bytes(24), 'hex'), $4,
        $5, CAST($6 AS timestamp), $1, $1
      )
      RETURNING share_id, share_token
      `,
      [viewer.userId, folderId, fileId, passwordHash, maxDownloadCount, expiresAt],
    );
    const share = {
      ...(result.rows[0] || {}),
      expires_at: expiresAt,
      max_download_count: maxDownloadCount,
      password_required: !!passwordHash,
    };
    await this.audit('SHARE_CREATE', viewer, {
      target_type: fileId != null ? 'FILE' : 'FOLDER',
      target_id: fileId ?? folderId,
      detail: { share_id: share.share_id, password_required: !!passwordHash, max_download_count: maxDownloadCount },
    });
    return share;
  }

  async shareList(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const offset = optionalNumber(params.offset, 'offset') || 0;
    const limit = Math.min(Math.max(optionalNumber(params.limit, 'limit') || 20, 1), 100);
    const result = await this.databaseService.query(
      `
      SELECT s.share_id, s.folder_id, s.file_id, s.share_token, s.max_download_count,
             s.download_count, s.expires_at, s.revoked_yn, s.created_at, s.updated_at,
             CASE
               WHEN s.revoked_yn = 'Y' THEN 'REVOKED'
               WHEN s.expires_at IS NOT NULL AND s.expires_at <= CURRENT_TIMESTAMP THEN 'EXPIRED'
               WHEN s.max_download_count IS NOT NULL AND s.download_count >= s.max_download_count THEN 'LIMIT_REACHED'
               ELSE 'ACTIVE'
             END AS status_cd,
             CASE WHEN s.password_hash IS NULL THEN false ELSE true END AS password_required,
             f.file_name, f.display_name, folder.folder_name
      FROM wh_share s
      LEFT JOIN wh_file f ON f.file_id = s.file_id
      LEFT JOIN wh_folder folder ON folder.folder_id = s.folder_id
      WHERE s.owner_user_id = $1
      ORDER BY s.created_at DESC, s.share_id DESC
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

  async revokeShare(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const shareId = requiredNumber(params.share_id, 'share_id is required');
    const result = await this.databaseService.query<{ share_id: number }>(
      `
      UPDATE wh_share
      SET revoked_yn = 'Y',
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $2
      WHERE share_id = $1
        AND owner_user_id = $2
        AND revoked_yn = 'N'
      RETURNING share_id
      `,
      [shareId, viewer.userId],
    );
    if (result.rowCount === 0) {
      throw ApiException.badRequest('share not found');
    }
    await this.audit('SHARE_REVOKE', viewer, { target_type: 'SHARE', target_id: shareId });
    return { share_id: shareId };
  }

  async auditList(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const offset = optionalNumber(params.offset, 'offset') || 0;
    const limit = Math.min(Math.max(optionalNumber(params.limit, 'limit') || 20, 1), 100);
    const includeAllUsers = isAdminViewer(viewer) && optionalBoolean(params.all_users);
    const actorUserId = optionalText(params.actor_user_id);
    const actionCd = optionalText(params.action_cd);
    const targetType = optionalText(params.target_type);
    const dateFrom = optionalDateOnly(params.date_from);
    const dateTo = optionalDateOnly(params.date_to);
    try {
      const result = await this.databaseService.query(
        `
        SELECT log_id, actor_user_id, action_cd, target_type, target_id, detail_json, created_at
        FROM wh_audit_log
        WHERE ($2::boolean OR actor_user_id = $1)
          AND ($5::varchar IS NULL OR actor_user_id = $5)
          AND ($6::varchar IS NULL OR action_cd = $6)
          AND ($7::varchar IS NULL OR target_type = $7)
          AND ($8::date IS NULL OR created_at >= $8::date)
          AND ($9::date IS NULL OR created_at < ($9::date + INTERVAL '1 day'))
        ORDER BY log_id DESC
        LIMIT $3 OFFSET $4
        `,
        [viewer.userId, includeAllUsers, limit + 1, offset, actorUserId, actionCd, targetType, dateFrom, dateTo],
      );
      const rows = result.rows.slice(0, limit);
      return {
        items: rows,
        offset,
        limit,
        next_offset: offset + rows.length,
        has_more: result.rows.length > limit,
      };
    } catch {
      return { items: [], offset, limit, next_offset: offset, has_more: false };
    }
  }

  private async duplicateInfo(ownerUserId: string, contentSha256: string): Promise<{ count: number; items: Record<string, unknown>[] }> {
    const result = await this.databaseService.query(
      `
      SELECT file_id, file_name, display_name, file_size, created_at
      FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'N'
        AND content_sha256 = $2
      ORDER BY created_at DESC, file_id DESC
      LIMIT 10
      `,
      [ownerUserId, contentSha256],
    );
    return { count: result.rowCount || 0, items: result.rows };
  }

  private async ensureOwnedFolder(folderId: number | null, viewer: Viewer): Promise<void> {
    if (folderId == null) {
      return;
    }
    const result = await this.databaseService.query(
      `
      SELECT 1
      FROM wh_folder
      WHERE folder_id = $1
        AND owner_user_id = $2
        AND deleted_yn = 'N'
      LIMIT 1
      `,
      [folderId, viewer.userId],
    );
    if (result.rowCount === 0) {
      throw ApiException.badRequest('folder not found');
    }
  }

  private async ensureShareTarget(fileId: number | null, folderId: number | null, viewer: Viewer): Promise<void> {
    const result = fileId != null
      ? await this.databaseService.query(
        `
        SELECT 1
        FROM wh_file
        WHERE file_id = $1
          AND owner_user_id = $2
          AND deleted_yn = 'N'
        LIMIT 1
        `,
        [fileId, viewer.userId],
      )
      : await this.databaseService.query(
        `
        SELECT 1
        FROM wh_folder
        WHERE folder_id = $1
          AND owner_user_id = $2
          AND deleted_yn = 'N'
        LIMIT 1
        `,
        [folderId, viewer.userId],
      );
    if (result.rowCount === 0) {
      throw ApiException.badRequest('share target not found');
    }
  }

  private async audit(action: string, viewer: Viewer, detail: AuditDetail = {}): Promise<void> {
    try {
      await this.databaseService.query(
        `
        INSERT INTO wh_audit_log (
          actor_user_id, action_cd, target_type, target_id, detail_json, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5::jsonb, $1, $1
        )
        `,
        [
          viewer.userId,
          action,
          detail.target_type || null,
          detail.target_id || null,
          JSON.stringify(detail.detail || {}),
        ],
      );
    } catch {
      undefined;
    }
  }
}

function requiredText(value: unknown, message: string): string {
  const text = optionalText(value);
  if (!text) {
    throw ApiException.badRequest(message);
  }
  return text;
}

function normalizeTags(value: unknown): string | null {
  const text = optionalText(value);
  if (!text) {
    return null;
  }
  return text
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 30)
    .join(', ');
}

async function fileHash(file: Express.Multer.File): Promise<string> {
  return createHash('sha256').update(await fileBytes(file)).digest('hex');
}

async function fileBytes(file: Express.Multer.File): Promise<Buffer> {
  if (file.buffer) {
    return file.buffer;
  }
  if (file.path) {
    return readFile(file.path);
  }
  return Buffer.alloc(0);
}

async function detectOriginalCreatedAt(
  file: Express.Multer.File,
  fallback: string,
  contentKind: string,
): Promise<string> {
  if (contentKind !== 'IMAGE') {
    return fallback;
  }
  try {
    const input = file.path || file.buffer;
    const metadata = await sharp(input).metadata();
    const exif = metadata.exif?.toString('latin1') || '';
    const match = exif.match(/(20\d{2}|19\d{2}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!match) {
      return fallback;
    }
    const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
  } catch {
    return fallback;
  }
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function isAdminViewer(viewer: Viewer): boolean {
  return viewer.roles.some((role) => role === 'ROLE_ADMIN' || role === 'ROLE_SUPER_ADMIN');
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

function optionalBoolean(value: unknown): boolean {
  const text = optionalText(value);
  return text === 'true' || text === 'Y' || text === '1';
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
  if (file.path) {
    await rename(file.path, absolutePath);
  } else {
    await writeFile(absolutePath, file.buffer);
  }
  const publicPath = `/storage/${ownerDir}/${yyyy}/${mm}/${dd}/${storedName}`;
  return {
    storagePath: absolutePath,
    publicPath,
    storedName,
  };
}

async function removeTempUploadedFile(file: Express.Multer.File): Promise<void> {
  if (!file.path) {
    return;
  }
  try {
    await unlink(file.path);
  } catch {
    // Temporary upload cleanup is best-effort.
  }
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
