import { describe, expect, it } from '@jest/globals';
import { hasMediaAccessPermission, hasMediaPermission } from './permission.util';

describe('permission util media access', () => {
  it('accepts webhard permissions for media file access', () => {
    const permissions = {
      WEBHARD_SERVICE: ['WRITE', 'DELETE', 'SHARE'],
    };

    expect(hasMediaAccessPermission(permissions)).toBe(true);
    expect(hasMediaPermission(permissions, 'WRITE')).toBe(true);
    expect(hasMediaPermission(permissions, 'ADMIN')).toBe(false);
  });
});
