import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { DatabaseService } from '../database/database.service';

export interface Viewer {
  userId: string;
  roles: string[];
}

@Injectable()
export class DriveService {
  constructor(private readonly databaseService: DatabaseService) {}

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
      SELECT file_id, folder_id, file_name, file_size, content_type, storage_path, created_at, updated_at
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
    const folderId = optionalNumber(params.folder_id, 'folder_id');
    const fileName = requiredText(params.file_name, 'file_name is required');
    const storagePath = requiredText(params.storage_path, 'storage_path is required');
    const fileSize = optionalNumber(params.file_size, 'file_size') || 0;
    const contentType = optionalText(params.content_type) || 'application/octet-stream';

    const result = await this.databaseService.query<{ file_id: number }>(
      `
      INSERT INTO wh_file (
        owner_user_id, folder_id, file_name, file_size, content_type, storage_path, created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $1, $1
      )
      RETURNING file_id
      `,
      [viewer.userId, folderId, fileName, fileSize, contentType, storagePath],
    );
    return { file_id: result.rows[0]?.file_id };
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
