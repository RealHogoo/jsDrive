import { describe, expect, it, jest } from '@jest/globals';
import { scryptSync } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DatabaseService } from '../database/database.service';

jest.mock('archiver', () => jest.fn());

import { WebController } from './web.controller';

type MockQuery = (sql: string, params?: unknown[]) => Promise<any>;

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
});

function controllerWith(query: jest.MockedFunction<MockQuery>): WebController {
  return new WebController(
    {} as any,
    { query: query as unknown as DatabaseService['query'] } as DatabaseService,
    {} as any,
    {} as any,
  );
}

function mockResponse() {
  const response: any = {
    download: jest.fn(),
    send: jest.fn(),
    status: jest.fn(),
    type: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.type.mockReturnValue(response);
  response.send.mockReturnValue(response);
  return response;
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
