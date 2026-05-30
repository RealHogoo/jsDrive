import { describe, expect, it, jest } from '@jest/globals';
import { scryptSync } from 'crypto';
import { EventEmitter } from 'events';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DatabaseService } from '../database/database.service';

jest.mock('archiver', () => jest.fn());

import { WebController } from './web.controller';

type MockQuery = (sql: string, params?: unknown[]) => Promise<any>;
const archiverMock = jest.requireMock('archiver') as jest.Mock;

describe('WebController share download security', () => {
  const token = '0123456789abcdef0123456789abcdef0123456789abcdef';

  it('does not accept share passwords from GET query parameters', async () => {
    const query = jest.fn<MockQuery>().mockResolvedValueOnce({
      rows: [shareRow({ password_hash: passwordHash('secret') })],
      rowCount: 1,
    });
    const controller = controllerWith(query);
    const response = mockResponse();

    await controller.shareDownload(token, response as any);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.download).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('accepts share passwords from POST body parameters', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'webhard-share-test-'));
    const filePath = join(tempDir, 'secret.txt');
    writeFileSync(filePath, 'download');
    try {
      const query = jest.fn<MockQuery>()
        .mockResolvedValueOnce({
          rows: [shareRow({ password_hash: passwordHash('secret'), storage_path: filePath })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const controller = controllerWith(query);
      const response = mockResponse();

      await controller.shareDownloadWithPassword(token, { password: 'secret' }, response as any);

      expect(response.download).toHaveBeenCalledWith(filePath, 'secret.txt');
      expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE wh_share'), [1]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('streams folder shares as zip archives', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'webhard-folder-share-test-'));
    const filePath = join(tempDir, 'folder-file.txt');
    writeFileSync(filePath, 'download');
    try {
      const archive = mockArchive();
      archiverMock.mockReturnValueOnce(archive);
      const query = jest.fn<MockQuery>()
        .mockResolvedValueOnce({
          rows: [shareRow({
            file_id: null,
            folder_id: 3,
            folder_name: '문서',
            storage_path: null,
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            file_id: 5,
            file_name: 'folder-file.txt',
            display_name: 'folder-file.txt',
            storage_path: filePath,
            folder_path: '문서',
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const controller = controllerWith(query);
      const response = mockResponse();

      await controller.shareDownload(token, response as any);

      expect(response.attachment).toHaveBeenCalledWith('문서.zip');
      expect(archive.file).toHaveBeenCalledWith(filePath, { name: '문서/001-folder-file.txt' });
      expect(query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE wh_share'), [1]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('requires webhard access permission for direct file downloads', async () => {
    const query = jest.fn<MockQuery>();
    const adminServiceClient = {
      fetchCurrentUser: jest.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({
        user_id: 'USER1',
        roles: [],
        service_permissions: {},
      }),
    };
    const controller = controllerWith(query, adminServiceClient);
    const response = mockResponse();

    await controller.fileDownload('1', requestWithBearerToken() as any, response as any);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(query).not.toHaveBeenCalled();
  });
});

function controllerWith(query: jest.MockedFunction<MockQuery>, adminServiceClient: Record<string, unknown> = {}): WebController {
  return new WebController(
    adminServiceClient as any,
    { query: query as unknown as DatabaseService['query'] } as DatabaseService,
    {} as any,
    {} as any,
  );
}

function mockResponse() {
  const response: any = Object.assign(new EventEmitter(), {
    attachment: jest.fn(),
    download: jest.fn(),
    send: jest.fn(),
    status: jest.fn(),
    type: jest.fn(),
  });
  response.attachment.mockReturnValue(response);
  response.status.mockReturnValue(response);
  response.type.mockReturnValue(response);
  response.send.mockReturnValue(response);
  return response;
}

function mockArchive() {
  const archive: any = new EventEmitter();
  let response: EventEmitter | null = null;
  archive.file = jest.fn();
  archive.pipe = jest.fn((target: EventEmitter) => {
    response = target;
  });
  archive.finalize = jest.fn(() => Promise.resolve().then(() => {
    response?.emit('finish');
  }));
  return archive;
}

function requestWithBearerToken() {
  return {
    header: jest.fn((name: string) => {
      if (name.toLowerCase() === 'authorization') {
        return 'Bearer token';
      }
      return '';
    }),
  };
}

function shareRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    share_id: 1,
    file_id: 1,
    folder_id: null,
    password_hash: null,
    max_download_count: null,
    download_count: 0,
    file_name: 'secret.txt',
    display_name: 'secret.txt',
    storage_path: 'missing.txt',
    content_type: 'text/plain',
    content_kind: 'DOCUMENT',
    file_size: '8',
    thumbnail_path: null,
    expires_at: null,
    ...overrides,
  };
}

function passwordHash(password: string): string {
  const salt = 'test-salt';
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
