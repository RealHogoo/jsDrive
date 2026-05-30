import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DatabaseService } from '../database/database.service';
import { DriveService } from './drive.service';
import { IndexingService } from './indexing.service';

type MockQuery = (sql: string, params?: unknown[]) => Promise<any>;

describe('DriveService management features', () => {
  let tempDir: string;
  let indexingService: Pick<IndexingService, 'ensureNotRunning'>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'webhard-drive-test-'));
    indexingService = { ensureNotRunning: jest.fn<() => Promise<void>>().mockResolvedValue() };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('updates editable file metadata for an owned active file', async () => {
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({
        rows: [{ file_id: 7, file_name: 'renamed.txt', display_name: '보고서', memo: '메모', tags: '업무, 자료' }],
        rowCount: 1,
      });
    const service = serviceWith(query, indexingService);

    await expect(service.updateFileMetadata({
      file_id: 7,
      file_name: 'renamed.txt',
      display_name: '보고서',
      memo: '메모',
      tags: '업무, 자료',
    }, { userId: 'ADMIN', roles: [] })).resolves.toMatchObject({
      file_id: 7,
      display_name: '보고서',
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE wh_file'), [
      7,
      'ADMIN',
      'renamed.txt',
      '보고서',
      '메모',
      '업무, 자료',
    ]);
  });

  it('moves files only when the target folder belongs to the viewer', async () => {
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({ rows: [{ file_id: 3, folder_id: 9 }], rowCount: 1 });
    const service = serviceWith(query, indexingService);

    await expect(service.moveFile({ file_id: 3, folder_id: 9 }, { userId: 'ADMIN', roles: [] })).resolves.toEqual({
      file_id: 3,
      folder_id: 9,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('EXISTS'), [3, 'ADMIN', 9]);
  });

  it('uses all-user dashboard scope for admins and current-user scope otherwise', async () => {
    const adminQuery = dashboardQuery();
    const adminService = serviceWith(adminQuery, indexingService);

    await expect(adminService.dashboardSummary({}, { userId: 'ADMIN', roles: ['ROLE_ADMIN'] })).resolves.toMatchObject({
      scope: 'ALL_USERS',
      by_owner: [{ owner_user_id: 'USER1' }],
    });
    expect(adminQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('$2::boolean OR owner_user_id = $1'), ['ADMIN', true]);

    const userQuery = dashboardQuery();
    const userService = serviceWith(userQuery, indexingService);
    await expect(userService.dashboardSummary({}, { userId: 'USER1', roles: [] })).resolves.toMatchObject({
      scope: 'CURRENT_USER',
      by_owner: [],
    });
    expect(userQuery).toHaveBeenNthCalledWith(1, expect.any(String), ['USER1', false]);
  });

  it('backfills missing content hashes from existing files', async () => {
    const filePath = join(tempDir, 'sample.txt');
    writeFileSync(filePath, 'hello');
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({ rows: [{ file_id: 1, owner_user_id: 'ADMIN', storage_path: filePath }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const service = serviceWith(query, indexingService);

    await expect(service.backfillHashes({ limit: 10 }, { userId: 'ADMIN', roles: [] })).resolves.toMatchObject({
      scanned_count: 1,
      updated_count: 1,
      skipped_count: 0,
      has_more: false,
    });
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('SET content_sha256 = $2'), [
      1,
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      'ADMIN',
    ]);
  });
});

function serviceWith(query: jest.MockedFunction<MockQuery>, indexingService: Pick<IndexingService, 'ensureNotRunning'>): DriveService {
  return new DriveService({ query: query as unknown as DatabaseService['query'] } as DatabaseService, indexingService as IndexingService);
}

function dashboardQuery(): jest.MockedFunction<MockQuery> {
  return jest.fn<MockQuery>()
    .mockResolvedValueOnce({ rows: [{ file_count: '2', total_bytes: '100', trash_count: '0', trash_bytes: '0' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ content_kind: 'IMAGE', file_count: '2', total_bytes: '100' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ folder_count: '1' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ duplicate_group_count: '1', reclaimable_bytes: '50' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ file_id: 1, file_name: 'a.jpg' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ owner_user_id: 'USER1', file_count: '2', total_bytes: '100' }], rowCount: 1 });
}
