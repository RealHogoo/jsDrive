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

  it('does not expose server storage paths in file list responses', async () => {
    const query = jest.fn<MockQuery>()
      .mockResolvedValueOnce({ rows: [{ file_id: 1, file_name: 'a.txt' }], rowCount: 1 });
    const service = serviceWith(query, indexingService);

    await expect(service.fileList({}, { userId: 'ADMIN', roles: [] })).resolves.toEqual({
      items: [{ file_id: 1, file_name: 'a.txt' }],
    });
    expect(query.mock.calls[0][0]).not.toContain('storage_path');
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
    .mockResolvedValueOnce({ rows: [{ owner_user_id: 'USER1', file_count: '2', total_bytes: '100' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ upload_count: '1', upload_bytes: '50' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ share_count: '2', active_share_count: '1' }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ log_id: 1, action_cd: 'FILE_UPLOAD' }], rowCount: 1 });
}
