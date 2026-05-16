import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { once } from 'events';
import { createWriteStream, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ApiException } from '../common/api-exception';
import { DatabaseService } from '../database/database.service';

const archiver = require('archiver') as (format: string, options: { zlib: { level: number } }) => any;

export interface DownloadViewer {
  userId: string;
}

@Injectable()
export class DownloadJobService {
  constructor(private readonly databaseService: DatabaseService) {}

  async startWeekDownload(params: Record<string, unknown>, viewer: DownloadViewer): Promise<Record<string, unknown>> {
    const weekStart = String(params.week_start || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      throw ApiException.badRequest('week_start is required');
    }
    const contentKind = normalizeContentKind(params.content_kind);
    const sortBasis = normalizeSortBasis(params.sort_basis);
    const result = await this.databaseService.query<{ job_id: number }>(
      `
      INSERT INTO wh_download_job (
        owner_user_id, status_cd, week_start, sort_basis, content_kind,
        message, created_by, updated_by
      ) VALUES (
        $1, 'RUNNING', CAST($2 AS date), $3, $4, 'download job started', $1, $1
      )
      RETURNING job_id
      `,
      [viewer.userId, weekStart, sortBasis, contentKind],
    );
    const jobId = result.rows[0]?.job_id;
    void this.runWeekDownload(jobId, viewer.userId, weekStart, sortBasis, contentKind);
    return { job_id: jobId, status_cd: 'RUNNING' };
  }

  async status(params: Record<string, unknown>, viewer: DownloadViewer): Promise<Record<string, unknown>> {
    const jobId = requiredJobId(params.job_id);
    const result = await this.databaseService.query(
      `
      SELECT job_id, status_cd, week_start, sort_basis, content_kind, total_count,
             processed_count, total_bytes, download_name, message, started_at, finished_at, updated_at
      FROM wh_download_job
      WHERE job_id = $1
        AND owner_user_id = $2
      `,
      [jobId, viewer.userId],
    );
    if (result.rowCount === 0) {
      throw ApiException.badRequest('download job not found');
    }
    return result.rows[0];
  }

  async list(params: Record<string, unknown>, viewer: DownloadViewer): Promise<Record<string, unknown>> {
    const offset = optionalNumber(params.offset) || 0;
    const limit = Math.min(Math.max(optionalNumber(params.limit) || 20, 1), 100);
    const result = await this.databaseService.query(
      `
      SELECT job_id, status_cd, week_start, sort_basis, content_kind, total_count,
             processed_count, total_bytes, download_name, message, started_at, finished_at, updated_at
      FROM wh_download_job
      WHERE owner_user_id = $1
      ORDER BY job_id DESC
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

  async completedJob(jobIdText: string, ownerUserId: string): Promise<Record<string, string> | null> {
    const jobId = Number(jobIdText);
    if (!Number.isSafeInteger(jobId) || jobId <= 0) {
      return null;
    }
    const result = await this.databaseService.query<{ zip_path: string; download_name: string }>(
      `
      SELECT zip_path, download_name
      FROM wh_download_job
      WHERE job_id = $1
        AND owner_user_id = $2
        AND status_cd = 'DONE'
      `,
      [jobId, ownerUserId],
    );
    const job = result.rows[0];
    if (!job?.zip_path || !existsSync(job.zip_path)) {
      return null;
    }
    return job;
  }

  private async runWeekDownload(
    jobId: number | undefined,
    ownerUserId: string,
    weekStart: string,
    sortBasis: 'ORIGINAL_CREATED' | 'UPLOADED',
    contentKind: string | null,
  ): Promise<void> {
    if (!jobId) {
      return;
    }
    try {
      const files = await this.weekFiles(ownerUserId, weekStart, sortBasis, contentKind);
      const existingFiles = files.filter((file) => file.storage_path && existsSync(file.storage_path));
      const limits = weekDownloadLimits();
      const totalBytes = existingFiles.reduce((sum, file) => sum + Number(file.file_size || 0), 0);
      if (existingFiles.length === 0) {
        await this.fail(jobId, 'download files not found');
        return;
      }
      if (existingFiles.length > limits.maxFiles || totalBytes > limits.maxBytes) {
        await this.fail(jobId, 'download size limit exceeded');
        return;
      }
      await this.updateProgress(jobId, existingFiles.length, 0, totalBytes, 'creating zip');
      const zipPath = join(tmpdir(), `webhard-${weekStart}-${randomUUID()}.zip`);
      const output = createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      const closed = once(output, 'close');
      const failed = Promise.race([
        once(output, 'error').then(([error]) => Promise.reject(error)),
        once(archive, 'error').then(([error]) => Promise.reject(error)),
      ]);
      archive.pipe(output);
      for (let index = 0; index < existingFiles.length; index++) {
        const file = existingFiles[index];
        archive.file(file.storage_path, { name: zipEntryName(file.file_name || `file-${file.file_id}`, index) });
        if (shouldUpdateProgress(index + 1, existingFiles.length)) {
          await this.updateProgress(jobId, existingFiles.length, index + 1, totalBytes, 'creating zip');
        }
      }
      await archive.finalize();
      await Promise.race([closed, failed]);
      await this.databaseService.query(
        `
        UPDATE wh_download_job
        SET status_cd = 'DONE',
            processed_count = total_count,
            zip_path = $2,
            download_name = $3,
            message = 'download ready',
            finished_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE job_id = $1
        `,
        [jobId, zipPath, `webhard-${weekStart}.zip`],
      );
    } catch {
      await this.fail(jobId, 'download job failed');
    }
  }

  private async weekFiles(
    ownerUserId: string,
    weekStart: string,
    sortBasis: 'ORIGINAL_CREATED' | 'UPLOADED',
    contentKind: string | null,
  ): Promise<Array<{ file_id: number; file_name: string; file_size: string; storage_path: string }>> {
    const dateColumn = sortBasis === 'UPLOADED' ? 'created_at' : 'original_created_at';
    const start = new Date(`${weekStart}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const result = await this.databaseService.query<{
      file_id: number;
      file_name: string;
      file_size: string;
      storage_path: string;
    }>(
      `
      SELECT file_id, file_name, file_size, storage_path
      FROM wh_file
      WHERE owner_user_id = $1
        AND deleted_yn = 'N'
        AND ${dateColumn} >= CAST($2 AS timestamp)
        AND ${dateColumn} < CAST($3 AS timestamp)
        AND ($4::varchar IS NULL OR content_kind = $4)
      ORDER BY ${dateColumn} DESC, file_id DESC
      `,
      [ownerUserId, start.toISOString(), end.toISOString(), contentKind],
    );
    return result.rows;
  }

  private async updateProgress(
    jobId: number,
    totalCount: number,
    processedCount: number,
    totalBytes: number,
    message: string,
  ): Promise<void> {
    await this.databaseService.query(
      `
      UPDATE wh_download_job
      SET total_count = $2,
          processed_count = $3,
          total_bytes = $4,
          message = $5,
          updated_at = CURRENT_TIMESTAMP
      WHERE job_id = $1
      `,
      [jobId, totalCount, processedCount, totalBytes, message],
    );
  }

  private async fail(jobId: number, message: string): Promise<void> {
    await this.databaseService.query(
      `
      UPDATE wh_download_job
      SET status_cd = 'FAILED',
          message = $2,
          finished_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE job_id = $1
      `,
      [jobId, message],
    );
  }
}

function requiredJobId(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw ApiException.badRequest('job_id is required');
  }
  return parsed;
}

function optionalNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.floor(parsed));
}

function normalizeContentKind(value: unknown): string | null {
  const text = String(value || '').trim().toUpperCase();
  if (!text || text === 'ALL') {
    return null;
  }
  return text === 'IMAGE' || text === 'VIDEO' || text === 'DOCUMENT' ? text : null;
}

function normalizeSortBasis(value: unknown): 'ORIGINAL_CREATED' | 'UPLOADED' {
  const text = String(value || '').trim().toUpperCase();
  if (!text || text === 'ORIGINAL_CREATED') {
    return 'ORIGINAL_CREATED';
  }
  return text === 'UPLOADED' || text === 'CREATED_AT' ? 'UPLOADED' : 'ORIGINAL_CREATED';
}

function zipEntryName(fileName: string, index: number): string {
  const safe = fileName.replace(/[\\/:*?"<>|]/g, '_').trim() || `file-${index + 1}`;
  return `${String(index + 1).padStart(3, '0')}-${safe}`;
}

function shouldUpdateProgress(processedCount: number, totalCount: number): boolean {
  return processedCount === totalCount || processedCount <= 10 || processedCount % 10 === 0;
}

function weekDownloadLimits(): { maxFiles: number; maxBytes: number } {
  return {
    maxFiles: positiveNumberEnv('WEBHARD_WEEK_DOWNLOAD_MAX_FILES') || 500,
    maxBytes: positiveNumberEnv('WEBHARD_WEEK_DOWNLOAD_MAX_BYTES')
      || (positiveNumberEnv('WEBHARD_WEEK_DOWNLOAD_MAX_MB') || 2048) * 1024 * 1024,
  };
}

function positiveNumberEnv(key: string): number | null {
  const parsed = Number(process.env[key] || '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
