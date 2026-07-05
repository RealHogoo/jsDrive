import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, scryptSync } from 'crypto';
import { mkdir, rename, unlink, writeFile } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'path';
import sharp from 'sharp';
import { ApiException } from '../common/api-exception';
import { ApiCode } from '../common/api-code';
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
        AND (owner_user_id = $2 OR owner_user_id = 'ADMIN')
        AND deleted_yn = 'N'
      `,
      [fileId, viewer.userId],
    );
    if (result.rowCount === 0) {
      throw ApiException.badRequest('file not found');
    }
    const file = result.rows[0] as Record<string, unknown>;
    if (!file.content_sha256) {
      return { ...file, duplicates: [] };
    }
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
    const root = resolvedStorageRoot();
    for (const file of result.rows) {
      const storagePath = safeExistingStoragePath(file.storage_path, root);
      if (!storagePath) {
        skipped++;
        continue;
      }
      const hash = await hashFile(storagePath);
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
    const includeAllUsers = isAdminViewer(viewer);
    const result = await this.databaseService.query<{ file_id: number }>(
      `
      UPDATE wh_file
      SET deleted_yn = 'Y',
          deleted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $2
      WHERE file_id = $1
        AND ($3::boolean OR owner_user_id = $2)
        AND deleted_yn = 'N'
      RETURNING file_id
      `,
      [fileId, viewer.userId, includeAllUsers],
    );
    if (result.rowCount === 0) {
      throw ApiException.badRequest('file not found');
    }
    const file = { file_id: result.rows[0]?.file_id };
    await this.audit('FILE_DELETE', viewer, { target_type: 'FILE', target_id: file.file_id as number | null });
    return file;
  }

  async deleteWeekFiles(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    if (!isAdminViewer(viewer)) {
      throw new ApiException(ApiCode.FORBIDDEN, HttpStatus.FORBIDDEN, 'admin permission is required');
    }
    const weekStart = optionalDateOnly(params.week_start);
    if (!weekStart) {
      throw ApiException.badRequest('week_start is required');
    }
    const contentKind = optionalContentKind(params.content_kind);
    const sortBasis = normalizeSortBasis(params.sort_basis);
    const dateColumn = sortBasisDateColumn(sortBasis);
    const start = startOfWeek(new Date(`${weekStart}T00:00:00.000Z`));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const contentKindFilter = contentKind ? 'AND content_kind = $4' : '';
    const queryParams = contentKind
      ? [viewer.userId, start.toISOString(), end.toISOString(), contentKind]
      : [viewer.userId, start.toISOString(), end.toISOString()];
    const result = await this.databaseService.query<{ file_id: number; file_size: string }>(
      `
      UPDATE wh_file
      SET deleted_yn = 'Y',
          deleted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $1
      WHERE deleted_yn = 'N'
        AND ${dateColumn} >= CAST($2 AS timestamp)
        AND ${dateColumn} < CAST($3 AS timestamp)
        ${contentKindFilter}
      RETURNING file_id, file_size
      `,
      queryParams,
    );
    const deletedCount = result.rowCount || 0;
    const deletedBytes = result.rows.reduce((sum, file) => sum + Number(file.file_size || 0), 0);
    await this.audit('FILE_DELETE_WEEK', viewer, {
      target_type: 'FILE',
      target_id: null,
      detail: {
        week_start: toDateOnly(start),
        week_end: toDateOnly(end),
        sort_basis: sortBasis,
        content_kind: contentKind || 'ALL',
        deleted_count: deletedCount,
        deleted_bytes: deletedBytes,
      },
    });
    return {
      week_start: start.toISOString(),
      week_end: end.toISOString(),
      sort_basis: sortBasis,
      content_kind: contentKind || 'ALL',
      deleted_count: deletedCount,
      deleted_bytes: deletedBytes,
    };
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
    const root = resolvedStorageRoot();
    await removeFileIfExists(file.storage_path, root);
    if (file.thumbnail_path) {
      await removeFileIfExists(file.thumbnail_path, root);
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
    const root = resolvedStorageRoot();
    for (const file of result.rows) {
      await removeFileIfExists(file.storage_path, root);
      if (file.thumbnail_path) {
        await removeFileIfExists(file.thumbnail_path, root);
      }
    }
    await this.audit('TRASH_PURGE_OLD', viewer, {
      detail: { retention_days: retentionDays, purged_count: result.rowCount || 0 },
    });
    return { retention_days: retentionDays, purged_count: result.rowCount || 0 };
  }

  async searchFiles(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    const keyword = optionalText(params.keyword);
    const keywordTokens = searchTokens(keyword);
    const contentKind = optionalContentKind(params.content_kind);
    const includeAllUsers = isAdminViewer(viewer);
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
      WHERE ($9::boolean OR owner_user_id = $1 OR owner_user_id = 'ADMIN')
        AND deleted_yn = 'N'
        AND (
          $2::varchar IS NULL
          OR lower(file_name) LIKE '%' || lower($2) || '%'
          OR lower(COALESCE(display_name, '')) LIKE '%' || lower($2) || '%'
          OR lower(COALESCE(tags, '')) LIKE '%' || lower($2) || '%'
          OR lower(COALESCE(memo, '')) LIKE '%' || lower($2) || '%'
          OR (
            cardinality($8::text[]) > 0
            AND NOT EXISTS (
              SELECT 1
              FROM unnest($8::text[]) AS term(value)
              WHERE NOT (
                lower(file_name) LIKE '%' || lower(term.value) || '%'
                OR lower(COALESCE(display_name, '')) LIKE '%' || lower(term.value) || '%'
                OR lower(COALESCE(tags, '')) LIKE '%' || lower(term.value) || '%'
                OR lower(COALESCE(memo, '')) LIKE '%' || lower(term.value) || '%'
              )
            )
          )
        )
        AND ($3::varchar IS NULL OR content_kind = $3)
        AND ($4::timestamp IS NULL OR ${dateColumn} >= $4::timestamp)
        AND ($5::timestamp IS NULL OR ${dateColumn} < $5::timestamp)
      ORDER BY ${dateColumn} DESC, file_id DESC
      LIMIT $6 OFFSET $7
      `,
      [viewer.userId, keyword, contentKind, dateFrom, dateToExclusive, limit + 1, offset, keywordTokens, includeAllUsers],
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
    const fileId = optionalNumber(params.file_id, 'file_id');
    const seekSeconds = optionalNumber(params.seek_seconds, 'seek_seconds');
    const thumbnailSeekSeconds = seekSeconds == null ? null : Math.min(Math.max(seekSeconds, 0), 24 * 60 * 60);
    const includeAllUsers = isAdminViewer(viewer);
    const fileFilter = fileId ? 'AND file_id = $3' : '';
    const ownerFilter = fileId ? 'AND ($4::boolean OR owner_user_id = $1)' : 'AND ($3::boolean OR owner_user_id = $1)';
    const thumbnailFilter = fileId ? '' : 'AND thumbnail_path IS NULL';
    const result = await this.databaseService.query<{
      file_id: number;
      owner_user_id: string;
      file_name: string;
      storage_path: string;
      content_kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'OTHER';
      original_created_at: string;
    }>(
      `
      SELECT file_id, owner_user_id, file_name, storage_path, content_kind, original_created_at
      FROM wh_file
      WHERE 1 = 1
        ${ownerFilter}
        AND deleted_yn = 'N'
        AND content_kind IN ('IMAGE', 'VIDEO')
        ${thumbnailFilter}
        ${fileFilter}
      ORDER BY file_id ASC
      LIMIT $2
      `,
      fileId ? [viewer.userId, limit, fileId, includeAllUsers] : [viewer.userId, limit, includeAllUsers],
    );
    let updated = 0;
    const root = resolvedStorageRoot();
    for (const file of result.rows) {
      const storagePath = safeExistingStoragePath(file.storage_path, root);
      if (!storagePath) {
        continue;
      }
      const thumbnailPath = await createThumbnail(
        file.content_kind,
        storagePath,
        file.owner_user_id,
        file.original_created_at || new Date().toISOString(),
        file.file_name,
        thumbnailSeekSeconds,
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

  async internalMediaList(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const viewerUserId = requiredText(params.viewer_user_id, 'viewer_user_id is required');
    const viewerIsAdmin = Boolean(params.viewer_is_admin);
    const limit = Math.min(Math.max(optionalNumber(params.limit, 'limit') || 500, 1), 1000);
    const result = await this.databaseService.query(
      `
      SELECT file_id, owner_user_id, file_name, display_name, memo, tags, file_size, content_type,
             content_kind, storage_path, public_path, thumbnail_path,
             media_public_yn, original_created_at, created_at, updated_at
      FROM wh_file
      WHERE deleted_yn = 'N'
        AND content_kind IN ('IMAGE', 'VIDEO')
        AND ($1::boolean OR owner_user_id = $2)
      ORDER BY updated_at DESC, file_id DESC
      LIMIT $3
      `,
      [viewerIsAdmin, viewerUserId, limit],
    );
    return { items: result.rows };
  }

  async internalMediaFileDetail(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const fileId = requiredNumber(params.file_id, 'file_id is required');
    const viewerUserId = requiredText(params.viewer_user_id, 'viewer_user_id is required');
    const viewerIsAdmin = Boolean(params.viewer_is_admin);
    const allowPublic = Boolean(params.allow_public);
    const result = await this.databaseService.query(
      `
      SELECT file_id, owner_user_id, file_name, display_name, memo, tags, file_size, content_type,
             content_kind, storage_path, public_path, thumbnail_path,
             media_public_yn, original_created_at, created_at, updated_at
      FROM wh_file
      WHERE deleted_yn = 'N'
        AND file_id = $1
        AND ($2::boolean OR owner_user_id = $3 OR ($4::boolean AND media_public_yn = 'Y'))
      LIMIT 1
      `,
      [fileId, viewerIsAdmin, viewerUserId, allowPublic],
    );
    return { item: result.rows[0] || null };
  }

  async internalMediaActiveIds(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const viewerUserId = requiredText(params.viewer_user_id, 'viewer_user_id is required');
    const viewerIsAdmin = Boolean(params.viewer_is_admin);
    const fileIds = arrayParam(params.file_ids)
      .map((item) => Number(item))
      .filter((item) => Number.isSafeInteger(item) && item > 0)
      .slice(0, 500);
    if (fileIds.length === 0) {
      return { file_ids: [] };
    }
    const result = await this.databaseService.query<{ file_id: number }>(
      `
      SELECT file_id
      FROM wh_file
      WHERE deleted_yn = 'N'
        AND content_kind IN ('IMAGE', 'VIDEO')
        AND file_id = ANY($1::bigint[])
        AND ($2::boolean OR owner_user_id = $3)
      `,
      [fileIds, viewerIsAdmin, viewerUserId],
    );
    return { file_ids: result.rows.map((row) => Number(row.file_id)) };
  }

  async internalMarkMediaPublic(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const ownerUserId = requiredText(params.owner_user_id, 'owner_user_id is required');
    const fileIds = arrayParam(params.file_ids)
      .map((item) => Number(item))
      .filter((item) => Number.isSafeInteger(item) && item > 0)
      .slice(0, 500);
    if (fileIds.length === 0) {
      return { updated_count: 0 };
    }
    const result = await this.databaseService.query<{ file_id: number }>(
      `
      UPDATE wh_file
      SET media_public_yn = 'Y',
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $1
      WHERE owner_user_id = $1
        AND file_id = ANY($2::bigint[])
        AND deleted_yn = 'N'
      RETURNING file_id
      `,
      [ownerUserId, fileIds],
    );
    return { updated_count: result.rowCount || 0, file_ids: result.rows.map((row) => Number(row.file_id)) };
  }

  async internalMediaFileStream(params: Record<string, unknown>): Promise<{
    storagePath: string;
    fileName: string;
    contentType: string;
    asAttachment: boolean;
  }> {
    const fileId = requiredNumber(params.file_id, 'file_id is required');
    const viewerUserId = requiredText(params.viewer_user_id, 'viewer_user_id is required');
    const viewerIsAdmin = Boolean(params.viewer_is_admin);
    const allowPublic = Boolean(params.allow_public);
    const kind = requiredText(params.file_kind, 'file_kind is required');
    const result = await this.databaseService.query<{
      file_name: string;
      storage_path: string;
      thumbnail_path: string | null;
      content_type: string;
    }>(
      `
      SELECT file_name, storage_path, thumbnail_path, content_type
      FROM wh_file
      WHERE deleted_yn = 'N'
        AND file_id = $1
        AND ($2::boolean OR owner_user_id = $3 OR ($4::boolean AND media_public_yn = 'Y'))
      LIMIT 1
      `,
      [fileId, viewerIsAdmin, viewerUserId, allowPublic],
    );
    const item = result.rows[0];
    if (!item) {
      throw ApiException.badRequest('media file not found');
    }
    const rawPath = kind === 'thumbnail' ? item.thumbnail_path : item.storage_path;
    const storagePath = safeExistingStoragePath(String(rawPath || ''));
    if (!storagePath) {
      throw ApiException.badRequest('media file path not found');
    }
    if (kind === 'thumbnail') {
      return {
        storagePath,
        fileName: 'thumbnail.webp',
        contentType: 'image/webp',
        asAttachment: false,
      };
    }
    if (kind === 'download') {
      return {
        storagePath,
        fileName: String(item.file_name || 'download'),
        contentType: 'application/octet-stream',
        asAttachment: true,
      };
    }
    if (kind === 'content') {
      const contentType = safeInlineContentType(String(item.content_type || ''));
      return {
        storagePath,
        fileName: String(item.file_name || 'download'),
        contentType: contentType || 'application/octet-stream',
        asAttachment: !contentType,
      };
    }
    throw ApiException.badRequest('invalid file kind');
  }

  async internalRegisterYoutubeFile(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const ownerUserId = requiredText(params.owner_user_id, 'owner_user_id is required');
    const fileName = await this.youtubeFileNameWithInternalNumber(normalizeFileName(requiredText(params.file_name, 'file_name is required')));
    const fileSize = optionalNumber(params.file_size, 'file_size') || 0;
    const contentType = optionalText(params.content_type) || 'video/mp4';
    if (contentKindFor(contentType, fileName) !== 'VIDEO') {
      throw ApiException.badRequest('youtube media must be a video file');
    }
    const storagePath = validateOwnedStoragePath(requiredText(params.storage_path, 'storage_path is required'), ownerUserId);
    if (!existsSync(storagePath)) {
      throw ApiException.badRequest('storage_path was not found');
    }
    const publicPath = optionalText(params.public_path);
    const thumbnailPathText = optionalText(params.thumbnail_path);
    const thumbnailPath = thumbnailPathText ? validateOwnedStoragePath(thumbnailPathText, ownerUserId) : null;
    const originalCreatedAt = optionalTimestamp(params.original_created_at, 'original_created_at') || new Date().toISOString();
    const contentSha256 = optionalText(params.content_sha256);
    const mediaPublicYn = optionalBoolean(params.media_public_yn) ? 'Y' : 'N';
    const result = await this.databaseService.query<{ file_id: number }>(
      `
      INSERT INTO wh_file (
        owner_user_id, folder_id, file_name, display_name, file_size, content_type, content_kind,
        storage_path, public_path, thumbnail_path, media_public_yn, original_created_at, content_sha256, created_by, updated_by
      ) VALUES (
        $1, NULL, $2, $2, $3, $4, 'VIDEO',
        $5, $6, $7, $8, CAST($9 AS timestamp), $10, $1, $1
      )
      RETURNING file_id
      `,
      [ownerUserId, fileName, fileSize, contentType, storagePath, publicPath, thumbnailPath, mediaPublicYn, originalCreatedAt, contentSha256],
    );
    const fileId = result.rows[0]?.file_id || null;
    await this.audit('FILE_REGISTER_YOUTUBE_INTERNAL', { userId: ownerUserId, roles: [] }, { target_type: 'FILE', target_id: fileId });
    return { file_id: fileId, file_name: fileName, karaoke_number: karaokeNumberFromText(fileName) };
  }

  private async youtubeFileNameWithInternalNumber(fileName: string): Promise<string> {
    if (karaokeNumberFromText(fileName)) {
      return fileName;
    }
    await this.databaseService.query(
      "CREATE SEQUENCE IF NOT EXISTS wh_youtube_karaoke_number_seq START WITH 9900001",
      [],
    );
    const result = await this.databaseService.query<{ next_number: string }>(
      "SELECT nextval('wh_youtube_karaoke_number_seq')::text AS next_number",
      [],
    );
    const nextNumber = String(result.rows[0]?.next_number || '').trim();
    if (!nextNumber) {
      throw ApiException.badRequest('youtube karaoke number could not be generated');
    }
    const extension = extname(fileName);
    const baseName = extension ? fileName.slice(0, -extension.length).trim() : fileName;
    return `KY.${nextNumber} ${baseName || 'youtube-video'}${extension || '.mp4'}`;
  }

  async internalMediaReady(): Promise<Record<string, unknown>> {
    await this.databaseService.ping();
    return {
      database: 'ready',
      storage_root: storageRoot(),
    };
  }

  async registerFile(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    await this.indexingService.ensureNotRunning(viewer);
    const folderId = optionalNumber(params.folder_id, 'folder_id');
    await this.ensureOwnedFolder(folderId, viewer);
    const fileName = requiredText(params.file_name, 'file_name is required');
    const storagePath = validateOwnedStoragePath(requiredText(params.storage_path, 'storage_path is required'), viewer.userId);
    const fileSize = optionalNumber(params.file_size, 'file_size') || 0;
    const contentType = optionalText(params.content_type) || 'application/octet-stream';
    const contentKind = validateAllowedFileType(contentType, fileName);
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
    try {
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
      const contentKind = validateAllowedFileType(contentType, fileName);
      const contentSha256 = await fileHash(file);
      const detectedOriginalCreatedAt = await detectOriginalCreatedAt(file, originalCreatedAt, contentKind);
      return await this.persistUploadedFile({
        file,
        folderId,
        fileName,
        contentType,
        contentKind,
        originalCreatedAt: detectedOriginalCreatedAt,
        contentSha256,
        viewer,
      });
    } catch (exception) {
      if (file) {
        await removeTempUploadedFile(file);
      }
      throw exception;
    }
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

    const items: Array<Record<string, unknown>> = [];
    try {
      const processed = await mapWithConcurrency(uploadFiles, uploadProcessingConcurrency(), async (file, index) => {
        const fileName = normalizeFileName(file.originalname);
        const contentType = file.mimetype || 'application/octet-stream';
        const contentKind = validateAllowedFileType(contentType, fileName);
        const requestedOriginalCreatedAt = optionalTimestamp(originalCreatedAtList[index], 'original_created_at')
          || new Date().toISOString();
        const originalCreatedAt = await detectOriginalCreatedAt(file, requestedOriginalCreatedAt, contentKind);
        const contentSha256 = await fileHash(file);
        return this.persistUploadedFile({
          file,
          folderId,
          fileName,
          contentType,
          contentKind,
          originalCreatedAt,
          contentSha256,
          viewer,
        });
      });
      items.push(...processed);
    } catch (exception) {
      await Promise.all(uploadFiles.map((file) => removeTempUploadedFile(file)));
      throw exception;
    }

    return { items, count: items.length };
  }

  private async persistUploadedFile(options: {
    file: Express.Multer.File;
    folderId: number | null;
    fileName: string;
    contentType: string;
    contentKind: string;
    originalCreatedAt: string;
    contentSha256: string;
    viewer: Viewer;
  }): Promise<Record<string, unknown>> {
    const duplicateInfoPromise = this.duplicateInfo(options.viewer.userId, options.contentSha256);
    const stored = await saveUploadedFile(options.file, options.originalCreatedAt, options.viewer.userId, options.fileName);
    const thumbnailPath = await createThumbnail(
      options.contentKind,
      stored.storagePath,
      options.viewer.userId,
      options.originalCreatedAt,
      stored.storedName,
    );
    const duplicateInfo = await duplicateInfoPromise;
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
        options.viewer.userId,
        options.folderId,
        options.fileName,
        options.file.size,
        options.contentType,
        options.contentKind,
        stored.storagePath,
        stored.publicPath,
        thumbnailPath,
        options.originalCreatedAt,
        options.contentSha256,
      ],
    );
    const uploaded = {
      file_id: result.rows[0]?.file_id,
      file_name: options.fileName,
      public_path: stored.publicPath,
      original_created_at: options.originalCreatedAt,
      content_kind: options.contentKind,
      thumbnail_path: thumbnailPath,
      content_sha256: options.contentSha256,
      duplicate_count: duplicateInfo.count,
      duplicate_files: duplicateInfo.items,
    };
    await this.audit('FILE_UPLOAD', options.viewer, { target_type: 'FILE', target_id: uploaded.file_id as number | null });
    return uploaded;
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
    const weekContentKindFilter = contentKind ? 'AND content_kind = $3' : '';
    const weekLimitParam = contentKind ? '$4' : '$3';
    const weekParams = contentKind
      ? [viewer.userId, upperBound, contentKind, safeWeeks]
      : [viewer.userId, upperBound, safeWeeks];

    const weekResult = await this.databaseService.query<{ week_start: string; item_count: string }>(
      `
      SELECT to_char(date_trunc('week', ${dateColumn})::date, 'YYYY-MM-DD') AS week_start,
             COUNT(*) AS item_count
      FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'N'
        AND ${dateColumn} < CAST($2 AS timestamp)
        ${weekContentKindFilter}
      GROUP BY date_trunc('week', ${dateColumn})::date
      ORDER BY week_start DESC
      LIMIT ${weekLimitParam}
      `,
      weekParams,
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
    const itemContentKindFilter = contentKind ? 'AND content_kind = $4' : '';
    const itemLimitParam = contentKind ? '$5' : '$4';
    const itemParams = contentKind
      ? [viewer.userId, oldestWeekStart.toISOString(), newestWeekEnd.toISOString(), contentKind, previewItemLimit]
      : [viewer.userId, oldestWeekStart.toISOString(), newestWeekEnd.toISOString(), previewItemLimit];

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
          ${itemContentKindFilter}
      )
      SELECT file_id, folder_id, file_name, display_name, file_size, content_type, content_kind,
             public_path, thumbnail_path, original_created_at, created_at
      FROM ranked
      WHERE rn <= ${itemLimitParam}
      ORDER BY ${dateColumn} DESC, file_id DESC
      `,
      itemParams,
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
    const contentKindFilter = contentKind ? 'AND content_kind = $4' : '';
    const limitParam = contentKind ? '$5' : '$4';
    const offsetParam = contentKind ? '$6' : '$5';
    const queryParams = contentKind
      ? [viewer.userId, start.toISOString(), end.toISOString(), contentKind, limit + 1, offset]
      : [viewer.userId, start.toISOString(), end.toISOString(), limit + 1, offset];

    const result = await this.databaseService.query(
      `
      SELECT file_id, folder_id, file_name, display_name, file_size, content_type, content_kind,
             public_path, thumbnail_path, original_created_at, created_at
      FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'N'
        AND ${dateColumn} >= CAST($2 AS timestamp)
        AND ${dateColumn} < CAST($3 AS timestamp)
        ${contentKindFilter}
      ORDER BY ${dateColumn} DESC, file_id DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
      `,
      queryParams,
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
      allowed_extensions: allowedUploadExtensions(),
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

function searchTokens(value: string | null): string[] {
  return uniqueTextValues(
    String(value || '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 2 || /^\d+$/.test(token)),
  ).slice(0, 8);
}

function uniqueTextValues(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const text = String(value || '').trim();
    if (text && !result.includes(text)) {
      result.push(text);
    }
  }
  return result;
}

function karaokeNumberFromText(value: string): string {
  const match = String(value || '').match(/\bKY[.\-_ ]?(\d{4,7})\b/i);
  if (match) {
    return `KY.${match[1]}`;
  }
  const numeric = String(value || '').match(/(?:^|[^\d])(\d{6,7})(?=[^\d]|$)/);
  return numeric ? `KY.${numeric[1]}` : '';
}

async function fileHash(file: Express.Multer.File): Promise<string> {
  if (file.buffer) {
    return createHash('sha256').update(file.buffer).digest('hex');
  }
  if (file.path) {
    return hashFile(file.path);
  }
  return createHash('sha256').digest('hex');
}

async function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const digest = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', rejectHash);
    stream.on('end', () => resolveHash(digest.digest('hex')));
  });
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

function uploadProcessingConcurrency(): number {
  const parsed = Number(process.env.WEBHARD_UPLOAD_PROCESS_CONCURRENCY || 2);
  if (!Number.isFinite(parsed)) {
    return 2;
  }
  return Math.min(Math.max(Math.floor(parsed), 1), 4);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));
  return results;
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

const ALLOWED_UPLOAD_TYPES: Array<{
  kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  extensions: Set<string>;
  mimeTypes: Set<string>;
}> = [
  { kind: 'IMAGE', extensions: new Set(['jpg', 'jpeg']), mimeTypes: new Set(['image/jpeg']) },
  { kind: 'IMAGE', extensions: new Set(['png']), mimeTypes: new Set(['image/png']) },
  { kind: 'IMAGE', extensions: new Set(['gif']), mimeTypes: new Set(['image/gif']) },
  { kind: 'IMAGE', extensions: new Set(['webp']), mimeTypes: new Set(['image/webp']) },
  { kind: 'IMAGE', extensions: new Set(['bmp']), mimeTypes: new Set(['image/bmp', 'image/x-ms-bmp']) },
  { kind: 'IMAGE', extensions: new Set(['heic']), mimeTypes: new Set(['image/heic', 'image/heif']) },
  { kind: 'VIDEO', extensions: new Set(['mp4']), mimeTypes: new Set(['video/mp4']) },
  { kind: 'VIDEO', extensions: new Set(['mov']), mimeTypes: new Set(['video/quicktime']) },
  { kind: 'VIDEO', extensions: new Set(['m4v']), mimeTypes: new Set(['video/x-m4v', 'video/mp4']) },
  { kind: 'VIDEO', extensions: new Set(['avi']), mimeTypes: new Set(['video/x-msvideo']) },
  { kind: 'VIDEO', extensions: new Set(['mkv']), mimeTypes: new Set(['video/x-matroska']) },
  { kind: 'VIDEO', extensions: new Set(['webm']), mimeTypes: new Set(['video/webm']) },
  { kind: 'DOCUMENT', extensions: new Set(['pdf']), mimeTypes: new Set(['application/pdf']) },
  { kind: 'DOCUMENT', extensions: new Set(['txt']), mimeTypes: new Set(['text/plain']) },
  { kind: 'DOCUMENT', extensions: new Set(['md']), mimeTypes: new Set(['text/markdown', 'text/plain']) },
  { kind: 'DOCUMENT', extensions: new Set(['csv']), mimeTypes: new Set(['text/csv', 'application/csv', 'application/vnd.ms-excel']) },
  { kind: 'DOCUMENT', extensions: new Set(['rtf']), mimeTypes: new Set(['application/rtf', 'text/rtf']) },
  { kind: 'DOCUMENT', extensions: new Set(['doc']), mimeTypes: new Set(['application/msword']) },
  { kind: 'DOCUMENT', extensions: new Set(['docx']), mimeTypes: new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document']) },
  { kind: 'DOCUMENT', extensions: new Set(['xls']), mimeTypes: new Set(['application/vnd.ms-excel']) },
  { kind: 'DOCUMENT', extensions: new Set(['xlsx']), mimeTypes: new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) },
  { kind: 'DOCUMENT', extensions: new Set(['ods']), mimeTypes: new Set(['application/vnd.oasis.opendocument.spreadsheet']) },
  { kind: 'DOCUMENT', extensions: new Set(['ppt']), mimeTypes: new Set(['application/vnd.ms-powerpoint']) },
  { kind: 'DOCUMENT', extensions: new Set(['pptx']), mimeTypes: new Set(['application/vnd.openxmlformats-officedocument.presentationml.presentation']) },
  { kind: 'DOCUMENT', extensions: new Set(['hwp']), mimeTypes: new Set(['application/x-hwp', 'application/haansofthwp', 'application/vnd.hancom.hwp']) },
  { kind: 'DOCUMENT', extensions: new Set(['hwpx']), mimeTypes: new Set(['application/vnd.hancom.hwpx', 'application/haansofthwpx']) },
];

function allowedUploadExtensions(): string[] {
  const extensions = new Set<string>();
  for (const rule of ALLOWED_UPLOAD_TYPES) {
    for (const extension of rule.extensions) {
      extensions.add(extension);
    }
  }
  return Array.from(extensions).sort();
}

function fileExtension(fileName: string): string {
  return extname(String(fileName || '')).replace(/^\./, '').toLowerCase();
}

function normalizedContentType(contentType: string): string {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function validateAllowedFileType(contentType: string, fileName: string): 'IMAGE' | 'VIDEO' | 'DOCUMENT' {
  const contentKind = contentKindFor(contentType, fileName);
  if (contentKind === 'OTHER') {
    throw ApiException.badRequest('unsupported file type. allowed file extensions and MIME types must match');
  }
  return contentKind;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${Math.floor(bytes / 1024 / 1024 / 1024)}GB`;
  }
  return `${Math.floor(bytes / 1024 / 1024)}MB`;
}

function contentKindFor(contentType: string, fileName: string): 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'OTHER' {
  const extension = fileExtension(fileName);
  if (!extension) {
    return 'OTHER';
  }
  const contentTypeText = normalizedContentType(contentType);
  const rule = ALLOWED_UPLOAD_TYPES.find((item) => item.extensions.has(extension));
  if (!rule || !rule.mimeTypes.has(contentTypeText)) {
    return 'OTHER';
  }
  return rule.kind;
}

function safeInlineContentType(value: string): string | null {
  const contentType = String(value || '').split(';')[0].trim().toLowerCase();
  const allowed = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-matroska',
    'video/x-msvideo',
  ]);
  return allowed.has(contentType) ? contentType : null;
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
  const itemsByWeek = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const basisDate = optionalText(sortBasis === 'UPLOADED' ? item.created_at : item.original_created_at);
    if (!basisDate) {
      continue;
    }
    const weekKey = toDateOnly(startOfWeek(new Date(basisDate)));
    const bucket = itemsByWeek.get(weekKey);
    if (bucket) {
      bucket.push(item);
    } else {
      itemsByWeek.set(weekKey, [item]);
    }
  }
  return weeks.map((week) => {
    const start = dateOnlyToUtc(week.week_start);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return {
      week_start: start.toISOString(),
      week_end: end.toISOString(),
      label: `${toDateOnly(start)} ~ ${previousDate(toDateOnly(end))}`,
      items: itemsByWeek.get(toDateOnly(start)) || [],
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
  seekSeconds: number | null = null,
): Promise<string | null> {
  if (contentKind === 'IMAGE') {
    return createImageThumbnail(storagePath, ownerUserId, originalCreatedAt, fileName);
  }
  if (contentKind === 'VIDEO') {
    return createVideoThumbnail(storagePath, ownerUserId, originalCreatedAt, fileName, seekSeconds ?? undefined);
  }
  return null;
}

async function removeFileIfExists(path: string, root = resolvedStorageRoot()): Promise<void> {
  const safePath = safeExistingStoragePath(path, root);
  if (safePath) {
    await unlink(safePath).catch(() => undefined);
  }
}

function safeExistingStoragePath(value: string | null | undefined, root = resolvedStorageRoot()): string | null {
  if (!value) {
    return null;
  }
  const target = resolve(String(value));
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === '' || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    return null;
  }
  return existsSync(target) ? target : null;
}

function resolvedStorageRoot(): string {
  return resolve(storageRoot());
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
