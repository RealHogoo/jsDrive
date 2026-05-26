import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DatabaseService } from '../database/database.service';

jest.mock('archiver', () => jest.fn());

import { DownloadJobService } from './download-job.service';

type MockQuery = (sql: string, params?: unknown[]) => Promise<any>;

describe('DownloadJobService', () => {
  let tempDir: string;
  let originalRetentionDays: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'webhard-download-test-'));
    originalRetentionDays = process.env.WEBHARD_DOWNLOAD_JOB_RETENTION_DAYS;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalRetentionDays === undefined) {
      delete process.env.WEBHARD_DOWNLOAD_JOB_RETENTION_DAYS;
    } else {
      process.env.WEBHARD_DOWNLOAD_JOB_RETENTION_DAYS = originalRetentionDays;
    }
  });

  it('removes expired zip files and clears their database paths', async () => {
    const existingZip = join(tempDir, 'done.zip');
    const missingZip = join(tempDir, 'missing.zip');
    writeFileSync(existingZip, 'zip');

    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({
        rows: [
          { job_id: 10, zip_path: existingZip },
          { job_id: 11, zip_path: missingZip },
        ],
        rowCount: 2,
      })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const service = new DownloadJobService({ query: query as unknown as DatabaseService['query'] } as DatabaseService);

    await expect(service.cleanupExpiredJobs({ retention_days: 14 }, { userId: 'ADMIN' })).resolves.toEqual({
      retention_days: 14,
      scanned_count: 2,
      removed_count: 1,
      has_more: false,
    });
    expect(existsSync(existingZip)).toBe(false);
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('FROM wh_download_job'), ['ADMIN', 14]);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('SET zip_path = NULL'), [10, 'ADMIN']);
    expect(query).toHaveBeenNthCalledWith(3, expect.stringContaining('SET zip_path = NULL'), [11, 'ADMIN']);
  });

  it('uses the retention default from environment and reports paged cleanup', async () => {
    process.env.WEBHARD_DOWNLOAD_JOB_RETENTION_DAYS = '30';
    const rows = Array.from({ length: 200 }, (_, index) => ({
      job_id: index + 1,
      zip_path: join(tempDir, `missing-${index}.zip`),
    }));
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({ rows, rowCount: rows.length })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const service = new DownloadJobService({ query: query as unknown as DatabaseService['query'] } as DatabaseService);

    await expect(service.cleanupExpiredJobs({}, { userId: 'ADMIN' })).resolves.toMatchObject({
      retention_days: 30,
      scanned_count: 200,
      removed_count: 0,
      has_more: true,
    });
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('LIMIT 200'), ['ADMIN', 30]);
    expect(query).toHaveBeenCalledTimes(201);
  });
});
