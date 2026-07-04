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
  let previousStorageRoot: string | undefined;
  let indexingService: Pick<IndexingService, 'ensureNotRunning'>;

  beforeEach(() => {
    previousStorageRoot = process.env.WEBHARD_STORAGE_ROOT;
    tempDir = mkdtempSync(join(tmpdir(), 'webhard-drive-test-'));
    process.env.WEBHARD_STORAGE_ROOT = tempDir;
    indexingService = { ensureNotRunning: jest.fn<() => Promise<void>>().mockResolvedValue() };
  });

  afterEach(() => {
    if (previousStorageRoot === undefined) {
      delete process.env.WEBHARD_STORAGE_ROOT;
    } else {
      process.env.WEBHARD_STORAGE_ROOT = previousStorageRoot;
    }
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

  it('does not expose server storage paths in file list responses', async () => {
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({ rows: [{ file_id: 1, file_name: 'a.txt' }], rowCount: 1 });
    const service = serviceWith(query, indexingService);

    await expect(service.fileList({}, { userId: 'ADMIN', roles: [] })).resolves.toEqual({
      items: [{ file_id: 1, file_name: 'a.txt' }],
    });
    expect(query.mock.calls[0][0]).not.toContain('storage_path');
  });

  it('includes admin-owned files in search results for non-owner lookup', async () => {
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({
        rows: [{ file_id: 238, owner_user_id: 'ADMIN', file_name: 'KY.9900001 Always Awake.mp4', content_kind: 'VIDEO' }],
        rowCount: 1,
      });
    const service = serviceWith(query, indexingService);

    await expect(service.searchFiles({ keyword: 'Always Awake', content_kind: 'VIDEO' }, { userId: 'USER1', roles: [] })).resolves.toMatchObject({
      items: [{ file_id: 238, file_name: 'KY.9900001 Always Awake.mp4' }],
      has_more: false,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("owner_user_id = 'ADMIN'"), [
      'USER1',
      'Always Awake',
      'VIDEO',
      null,
      null,
      21,
      0,
      ['Always', 'Awake'],
      false,
    ]);
  });

  it('requires share targets to belong to the viewer', async () => {
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const service = serviceWith(query, indexingService);

    await expect(service.createShare({ file_id: 9 }, { userId: 'ADMIN', roles: [] })).rejects.toThrow('share target not found');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM wh_file'), [9, 'ADMIN']);
  });

  it('returns owned folder tree paths for folder selectors', async () => {
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({
        rows: [{ folder_id: 1, folder_name: 'docs', folder_path: 'docs', depth: 1 }],
        rowCount: 1,
      });
    const service = serviceWith(query, indexingService);

    await expect(service.folderTree({ userId: 'ADMIN', roles: [] })).resolves.toEqual({
      items: [{ folder_id: 1, folder_name: 'docs', folder_path: 'docs', depth: 1 }],
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WITH RECURSIVE folders'), ['ADMIN']);
  });

  it('lists and revokes shares owned by the viewer', async () => {
    const listQuery = jest.fn<MockQuery>()
      .mockResolvedValueOnce({ rows: [{ share_id: 1, share_token: 'token' }], rowCount: 1 });
    const listService = serviceWith(listQuery, indexingService);

    await expect(listService.shareList({ limit: 20 }, { userId: 'ADMIN', roles: [] })).resolves.toMatchObject({
      items: [{ share_id: 1, share_token: 'token' }],
      has_more: false,
    });
    expect(listQuery).toHaveBeenCalledWith(expect.stringContaining('FROM wh_share s'), ['ADMIN', 21, 0]);

    const revokeQuery = jest.fn<MockQuery>()
      .mockResolvedValueOnce({ rows: [{ share_id: 1 }], rowCount: 1 });
    const revokeService = serviceWith(revokeQuery, indexingService);
    await expect(revokeService.revokeShare({ share_id: 1 }, { userId: 'ADMIN', roles: [] })).resolves.toEqual({
      share_id: 1,
    });
    expect(revokeQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE wh_share'), [1, 'ADMIN']);
  });

  it('allows admins to request all audit log rows', async () => {
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({ rows: [{ log_id: 1, actor_user_id: 'USER1' }], rowCount: 1 });
    const service = serviceWith(query, indexingService);

    await expect(service.auditList({ all_users: true }, { userId: 'ADMIN', roles: ['ROLE_ADMIN'] })).resolves.toMatchObject({
      items: [{ log_id: 1, actor_user_id: 'USER1' }],
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM wh_audit_log'), [
      'ADMIN',
      true,
      21,
      0,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('requires upload target folders to belong to the viewer', async () => {
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const service = serviceWith(query, indexingService);

    await expect(service.registerFile({
      folder_id: 99,
      file_name: 'a.txt',
      storage_path: join(tempDir, 'ADMIN', 'a.txt'),
    }, { userId: 'ADMIN', roles: [] })).rejects.toThrow('folder not found');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM wh_folder'), [99, 'ADMIN']);
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

  it('allows only admins to move all files in a week to trash', async () => {
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({
        rows: [
          { file_id: 1, file_size: '10' },
          { file_id: 2, file_size: '25' },
        ],
        rowCount: 2,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const service = serviceWith(query, indexingService);

    await expect(service.deleteWeekFiles({
      week_start: '2026-07-01',
      content_kind: 'VIDEO',
      sort_basis: 'UPLOADED',
    }, { userId: 'ADMIN', roles: ['ROLE_ADMIN'] })).resolves.toMatchObject({
      content_kind: 'VIDEO',
      deleted_count: 2,
      deleted_bytes: 35,
      sort_basis: 'UPLOADED',
    });

    expect(query.mock.calls[0][0]).toContain("SET deleted_yn = 'Y'");
    expect(query.mock.calls[0][0]).toContain('created_at >= CAST($2 AS timestamp)');
    expect(query.mock.calls[0][0]).toContain('content_kind = $4');
    expect(query.mock.calls[0][1]).toEqual([
      'ADMIN',
      '2026-06-29T00:00:00.000Z',
      '2026-07-06T00:00:00.000Z',
      'VIDEO',
    ]);
  });

  it('rejects week delete for non-admin viewers', async () => {
    const query = jest.fn<MockQuery>();
    const service = serviceWith(query, indexingService);

    await expect(service.deleteWeekFiles({
      week_start: '2026-07-01',
    }, { userId: 'USER1', roles: [] })).rejects.toThrow('admin permission is required');
    expect(query).not.toHaveBeenCalled();
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

  it('keeps text search token fallback and numeric keywords in search queries', async () => {
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({
        rows: [
          { file_id: 9900001, file_name: '9900001 서울 여행.mp4', display_name: '서울 여행' },
        ],
        rowCount: 1,
      });
    const service = serviceWith(query, indexingService);

    await expect(service.searchFiles({
      keyword: '9900001 서울',
      content_kind: 'VIDEO',
      limit: 10,
    }, { userId: 'ADMIN', roles: [] })).resolves.toMatchObject({
      items: [{ file_id: 9900001 }],
      has_more: false,
      sort_basis: 'ORIGINAL_CREATED',
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('cardinality($8::text[]) > 0'), [
      'ADMIN',
      '9900001 서울',
      'VIDEO',
      null,
      null,
      11,
      0,
      ['9900001', '서울'],
      false,
    ]);
  });

  it('uses the requested media date basis for search date filters', async () => {
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const service = serviceWith(query, indexingService);

    await service.searchFiles({
      keyword: '가족 영상',
      sort_basis: 'ORIGINAL_CREATED',
      date_from: '2026-07-01',
      date_to: '2026-07-02',
    }, { userId: 'ADMIN', roles: [] });

    const sql = query.mock.calls[0][0];
    expect(sql).toContain('original_created_at >= $4::timestamp');
    expect(sql).toContain('original_created_at < $5::timestamp');
    expect(query.mock.calls[0][1]).toEqual([
      'ADMIN',
      '가족 영상',
      null,
      '2026-07-01',
      '2026-07-03',
      21,
      0,
      ['가족', '영상'],
      false,
    ]);
  });

  it('uses uploaded date basis when explicitly requested', async () => {
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({ rows: [{ file_id: 12, file_name: 'clip.mp4' }], rowCount: 1 });
    const service = serviceWith(query, indexingService);

    await expect(service.searchFiles({
      keyword: 'clip',
      sort_basis: 'UPLOADED',
      date_from: '2026-07-03',
      date_to: '2026-07-03',
      limit: 5,
    }, { userId: 'USER1', roles: [] })).resolves.toMatchObject({
      items: [{ file_id: 12 }],
      sort_basis: 'UPLOADED',
    });

    const sql = query.mock.calls[0][0];
    expect(sql).toContain('created_at >= $4::timestamp');
    expect(sql).toContain('created_at < $5::timestamp');
    expect(sql).toContain('ORDER BY created_at DESC, file_id DESC');
    expect(query.mock.calls[0][1]).toEqual([
      'USER1',
      'clip',
      null,
      '2026-07-03',
      '2026-07-04',
      6,
      0,
      ['clip'],
      false,
    ]);
  });

  it('expands search scope for admin viewers', async () => {
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({ rows: [{ file_id: 42, owner_user_id: 'USER2', file_name: 'shared.mp4' }], rowCount: 1 });
    const service = serviceWith(query, indexingService);

    await service.searchFiles({ keyword: 'shared' }, { userId: 'ADMIN', roles: ['ROLE_ADMIN'] });

    expect(query.mock.calls[0][0]).toContain('($9::boolean OR owner_user_id = $1 OR owner_user_id = \'ADMIN\')');
    expect(query.mock.calls[0][1]).toEqual([
      'ADMIN',
      'shared',
      null,
      null,
      null,
      21,
      0,
      ['shared'],
      true,
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
    .mockResolvedValueOnce({ rows: [{ owner_user_id: 'USER1', file_count: '2', total_bytes: '100' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ upload_count: '1', upload_bytes: '50' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ share_count: '2', active_share_count: '1' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ log_id: 1, action_cd: 'FILE_UPLOAD' }], rowCount: 1 });
}
