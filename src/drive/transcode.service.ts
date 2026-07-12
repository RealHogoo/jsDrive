import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { mkdir, rename, stat, unlink } from 'fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { ApiException } from '../common/api-exception';
import { storageRoot } from '../common/storage-path';
import { DatabaseService } from '../database/database.service';

interface Viewer {
  userId: string;
  roles: string[];
}

interface FileRow {
  file_id: string;
  owner_user_id: string;
  file_name: string;
  storage_path: string;
  content_type: string;
}

interface JobRow {
  job_id: string;
  file_id: string;
}

const TRANSCODE_QUALITIES = [
  { quality: '1080', maxHeight: 1080, crf: 21 },
  { quality: '720', maxHeight: 720, crf: 23 },
];

@Injectable()
export class TranscodeService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastScheduledDate = '';

  constructor(private readonly databaseService: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
    this.timer = setInterval(() => {
      void this.runScheduledBatch();
    }, 60_000);
    void this.runScheduledBatch();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async enqueueFile(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    requireAdmin(viewer);
    const fileId = requiredNumber(params.file_id, 'file_id is required');
    const inserted = await this.databaseService.query<{ job_id: string }>(
      `
      INSERT INTO wh_transcode_job (file_id, status_cd, requested_by, message, created_by, updated_by)
      SELECT file_id, 'PENDING', $2, 'manual transcode requested', $2, $2
      FROM wh_file
      WHERE file_id = $1
        AND content_kind = 'VIDEO'
        AND deleted_yn = 'N'
      ON CONFLICT DO NOTHING
      RETURNING job_id
      `,
      [fileId, viewer.userId],
    );
    return { queued_count: inserted.rowCount || 0, job_id: inserted.rows[0]?.job_id || null };
  }

  async enqueuePending(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    requireAdmin(viewer);
    const limit = Math.min(Math.max(optionalNumber(params.limit) || transcodeDailyLimit(), 1), 500);
    const inserted = await this.databaseService.query<{ job_id: string }>(
      `
      INSERT INTO wh_transcode_job (file_id, status_cd, requested_by, message, created_by, updated_by)
      SELECT f.file_id, 'PENDING', $2, 'batch transcode requested', $2, $2
      FROM wh_file f
      WHERE f.content_kind = 'VIDEO'
        AND f.deleted_yn = 'N'
        AND NOT EXISTS (
          SELECT 1
          FROM wh_transcode_job active_job
          WHERE active_job.file_id = f.file_id
            AND active_job.status_cd IN ('PENDING', 'RUNNING')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM wh_transcode_variant v720
          JOIN wh_transcode_variant v1080 ON v1080.file_id = f.file_id AND v1080.quality = '1080'
          WHERE v720.file_id = f.file_id
            AND v720.quality = '720'
        )
      ORDER BY f.updated_at ASC, f.file_id ASC
      LIMIT $1
      ON CONFLICT DO NOTHING
      RETURNING job_id
      `,
      [limit, viewer.userId],
    );
    return { queued_count: inserted.rowCount || 0 };
  }

  async status(params: Record<string, unknown>, viewer: Viewer): Promise<Record<string, unknown>> {
    requireAdmin(viewer);
    const limit = Math.min(Math.max(optionalNumber(params.limit) || 20, 1), 100);
    const result = await this.databaseService.query(
      `
      SELECT j.job_id, j.file_id, f.file_name, f.owner_user_id, j.status_cd,
             j.attempt_count, j.message, j.started_at, j.finished_at, j.created_at, j.updated_at
      FROM wh_transcode_job j
      JOIN wh_file f ON f.file_id = j.file_id
      ORDER BY j.job_id DESC
      LIMIT $1
      `,
      [limit],
    );
    return { items: result.rows };
  }

  async runScheduledBatch(): Promise<void> {
    if (!transcodeEnabled() || this.running || !withinTranscodeWindow()) {
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastScheduledDate !== today) {
      await this.enqueueSystemPending();
      this.lastScheduledDate = today;
    }
    this.running = true;
    try {
      const maxJobs = Math.min(Math.max(transcodeBatchSize(), 1), 20);
      for (let index = 0; index < maxJobs; index += 1) {
        const job = await this.claimNextJob();
        if (!job) {
          return;
        }
        await this.processJob(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async ensureSchema(): Promise<void> {
    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS wh_transcode_job (
        job_id BIGSERIAL PRIMARY KEY,
        file_id BIGINT NOT NULL REFERENCES wh_file(file_id),
        status_cd VARCHAR(20) NOT NULL,
        requested_by VARCHAR(100) NOT NULL,
        source_path VARCHAR(1000),
        message VARCHAR(1000),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(100) NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by VARCHAR(100) NOT NULL,
        CONSTRAINT ck_wh_transcode_job_status CHECK (status_cd IN ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED'))
      )
    `);
    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS wh_transcode_variant (
        variant_id BIGSERIAL PRIMARY KEY,
        file_id BIGINT NOT NULL REFERENCES wh_file(file_id),
        quality VARCHAR(20) NOT NULL,
        storage_path VARCHAR(1000) NOT NULL,
        file_size BIGINT NOT NULL DEFAULT 0,
        content_sha256 VARCHAR(64),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(100) NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by VARCHAR(100) NOT NULL,
        CONSTRAINT ck_wh_transcode_variant_quality CHECK (quality IN ('720', '1080')),
        CONSTRAINT uq_wh_transcode_variant UNIQUE (file_id, quality)
      )
    `);
    await this.databaseService.query('CREATE INDEX IF NOT EXISTS idx_wh_transcode_job_01 ON wh_transcode_job (status_cd, created_at ASC, job_id ASC)');
    await this.databaseService.query("CREATE UNIQUE INDEX IF NOT EXISTS uq_wh_transcode_job_active ON wh_transcode_job (file_id) WHERE status_cd IN ('PENDING', 'RUNNING')");
    await this.databaseService.query('CREATE INDEX IF NOT EXISTS idx_wh_transcode_variant_01 ON wh_transcode_variant (file_id, quality)');
  }

  private async enqueueSystemPending(): Promise<void> {
    const limit = transcodeDailyLimit();
    await this.databaseService.query(
      `
      INSERT INTO wh_transcode_job (file_id, status_cd, requested_by, message, created_by, updated_by)
      SELECT f.file_id, 'PENDING', 'system', 'scheduled transcode requested', 'system', 'system'
      FROM wh_file f
      WHERE f.content_kind = 'VIDEO'
        AND f.deleted_yn = 'N'
        AND NOT EXISTS (
          SELECT 1
          FROM wh_transcode_job active_job
          WHERE active_job.file_id = f.file_id
            AND active_job.status_cd IN ('PENDING', 'RUNNING')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM wh_transcode_variant v720
          JOIN wh_transcode_variant v1080 ON v1080.file_id = f.file_id AND v1080.quality = '1080'
          WHERE v720.file_id = f.file_id
            AND v720.quality = '720'
        )
      ORDER BY f.updated_at ASC, f.file_id ASC
      LIMIT $1
      ON CONFLICT DO NOTHING
      `,
      [limit],
    );
  }

  private async claimNextJob(): Promise<JobRow | null> {
    const result = await this.databaseService.query<JobRow>(
      `
      UPDATE wh_transcode_job
      SET status_cd = 'RUNNING',
          started_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = 'system'
      WHERE job_id = (
        SELECT job_id
        FROM wh_transcode_job
        WHERE status_cd = 'PENDING'
        ORDER BY created_at ASC, job_id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING job_id, file_id
      `,
    );
    return result.rows[0] || null;
  }

  private async processJob(job: JobRow): Promise<void> {
    try {
      const file = await this.loadFile(job.file_id);
      if (!file) {
        await this.finishJob(job.job_id, 'SKIPPED', 'video file not found');
        return;
      }
      const sourcePath = safeExistingStoragePath(file.storage_path);
      if (!sourcePath) {
        await this.finishJob(job.job_id, 'FAILED', 'source file path not found');
        return;
      }
      await this.databaseService.query(
        'UPDATE wh_transcode_job SET source_path = $2, updated_at = CURRENT_TIMESTAMP WHERE job_id = $1',
        [job.job_id, sourcePath],
      );
      const variants = new Map<string, VariantResult>();
      for (const spec of TRANSCODE_QUALITIES) {
        const output = await this.transcodeVariant(file, sourcePath, spec.quality, spec.maxHeight, spec.crf);
        variants.set(spec.quality, output);
        await this.upsertVariant(file, output);
      }
      const playback = variants.get('1080');
      if (!playback) {
        throw new Error('1080p variant was not created');
      }
      const nextFileName = mp4FileName(file.file_name);
      await this.databaseService.query(
        `
        UPDATE wh_file
        SET file_name = $2,
            file_size = $3,
            content_type = 'video/mp4',
            storage_path = $4,
            content_sha256 = $5,
            updated_at = CURRENT_TIMESTAMP,
            updated_by = 'transcode-job'
        WHERE file_id = $1
        `,
        [file.file_id, nextFileName, playback.fileSize, playback.storagePath, playback.contentSha256],
      );
      if (resolve(sourcePath) !== resolve(playback.storagePath)) {
        await unlink(sourcePath).catch(() => undefined);
      }
      await this.finishJob(job.job_id, 'DONE', 'transcode finished; original file deleted');
    } catch (error) {
      await this.failJob(job.job_id, error instanceof Error ? error.message : String(error));
    }
  }

  private async loadFile(fileId: string): Promise<FileRow | null> {
    const result = await this.databaseService.query<FileRow>(
      `
      SELECT file_id, owner_user_id, file_name, storage_path, content_type
      FROM wh_file
      WHERE file_id = $1
        AND content_kind = 'VIDEO'
        AND deleted_yn = 'N'
      `,
      [fileId],
    );
    return result.rows[0] || null;
  }

  private async transcodeVariant(
    file: FileRow,
    sourcePath: string,
    quality: string,
    maxHeight: number,
    crf: number,
  ): Promise<VariantResult> {
    const targetDir = join(dirname(sourcePath), '.transcoded');
    await mkdir(targetDir, { recursive: true });
    const targetPath = join(targetDir, `${basename(sourcePath, extname(sourcePath))}.${file.file_id}.${quality}p.mp4`);
    const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    await runCommand(ffmpegCommand(), [
      '-y',
      '-i',
      sourcePath,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-vf',
      `scale=-2:'min(${maxHeight},ih)':force_original_aspect_ratio=decrease,format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      transcodePreset(),
      '-profile:v',
      'main',
      '-level',
      maxHeight >= 1080 ? '4.1' : '4.0',
      '-crf',
      String(crf),
      '-tag:v',
      'avc1',
      '-c:a',
      'aac',
      '-b:a',
      transcodeAudioBitrate(),
      '-ar',
      '48000',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      tempPath,
    ], transcodeTimeoutMs());
    const fileStat = await stat(tempPath);
    if (fileStat.size <= 0) {
      throw new Error(`${quality}p transcode output is empty`);
    }
    await rename(tempPath, targetPath);
    return {
      quality,
      storagePath: targetPath,
      fileSize: fileStat.size,
      contentSha256: await hashFile(targetPath),
    };
  }

  private async upsertVariant(file: FileRow, variant: VariantResult): Promise<void> {
    await this.databaseService.query(
      `
      INSERT INTO wh_transcode_variant (file_id, quality, storage_path, file_size, content_sha256, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $5, 'transcode-job', 'transcode-job')
      ON CONFLICT (file_id, quality)
      DO UPDATE SET storage_path = EXCLUDED.storage_path,
                    file_size = EXCLUDED.file_size,
                    content_sha256 = EXCLUDED.content_sha256,
                    updated_at = CURRENT_TIMESTAMP,
                    updated_by = 'transcode-job'
      `,
      [file.file_id, variant.quality, variant.storagePath, variant.fileSize, variant.contentSha256],
    );
  }

  private async finishJob(jobId: string, status: 'DONE' | 'SKIPPED' | 'FAILED', message: string): Promise<void> {
    await this.databaseService.query(
      `
      UPDATE wh_transcode_job
      SET status_cd = $2,
          message = $3,
          finished_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = 'system'
      WHERE job_id = $1
      `,
      [jobId, status, message.slice(0, 1000)],
    );
  }

  private async failJob(jobId: string, message: string): Promise<void> {
    await this.databaseService.query(
      `
      UPDATE wh_transcode_job
      SET status_cd = 'FAILED',
          attempt_count = attempt_count + 1,
          message = $2,
          finished_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          updated_by = 'system'
      WHERE job_id = $1
      `,
      [jobId, message.slice(0, 1000)],
    );
  }
}

interface VariantResult {
  quality: string;
  storagePath: string;
  fileSize: number;
  contentSha256: string;
}

function requireAdmin(viewer: Viewer): void {
  if (!viewer.roles.includes('ROLE_ADMIN')) {
    throw ApiException.forbidden('admin permission is required');
  }
}

function requiredNumber(value: unknown, message: string): number {
  const parsed = optionalNumber(value);
  if (parsed == null) {
    throw ApiException.badRequest(message);
  }
  return parsed;
}

function optionalNumber(value: unknown): number | null {
  if (value == null || String(value).trim() === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw ApiException.badRequest('numeric value is required');
  }
  return parsed;
}

function transcodeEnabled(): boolean {
  return String(process.env.WEBHARD_TRANSCODE_ENABLED || 'true').toLowerCase() !== 'false';
}

function transcodeDailyLimit(): number {
  return positiveInt(process.env.WEBHARD_TRANSCODE_DAILY_LIMIT, 20);
}

function transcodeBatchSize(): number {
  return positiveInt(process.env.WEBHARD_TRANSCODE_BATCH_SIZE, 1);
}

function transcodeTimeoutMs(): number {
  return positiveInt(process.env.WEBHARD_TRANSCODE_TIMEOUT_SECONDS, 7200) * 1000;
}

function transcodePreset(): string {
  return String(process.env.WEBHARD_TRANSCODE_PRESET || 'veryfast');
}

function transcodeAudioBitrate(): string {
  return String(process.env.WEBHARD_TRANSCODE_AUDIO_BITRATE || '160k');
}

function ffmpegCommand(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

function withinTranscodeWindow(date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  }).format(date));
  const start = positiveInt(process.env.WEBHARD_TRANSCODE_START_HOUR, 3);
  const end = positiveInt(process.env.WEBHARD_TRANSCODE_END_HOUR, 6);
  if (start === end) {
    return true;
  }
  if (start < end) {
    return hour >= start && hour < end;
  }
  return hour >= start || hour < end;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value || '');
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function mp4FileName(fileName: string): string {
  const base = basename(fileName, extname(fileName)).trim() || 'video';
  return `${base}.mp4`;
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

function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const digest = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', rejectHash);
    stream.on('end', () => resolveHash(digest.digest('hex')));
  });
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      rejectRun(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2000);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`${command} exited with code ${code}: ${stderr}`));
      }
    });
  });
}
