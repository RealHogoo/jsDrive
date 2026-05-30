import { describe, expect, it, jest } from '@jest/globals';
import { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from './auth.guard';

describe('AuthGuard webhard access', () => {
  it('rejects authenticated users without webhard permissions', async () => {
    const guard = guardWithUser({ roles: [], service_permissions: {} });

    await expect(guard.canActivate(contextWithAuth())).rejects.toThrow('웹하드 접근 권한이 없습니다.');
  });

  it('allows read APIs for users with any webhard permission', async () => {
    const guard = guardWithUser({
      roles: [],
      service_permissions: { WEBHARD_SERVICE: ['READ'] },
    });

    await expect(guard.canActivate(contextWithAuth())).resolves.toBe(true);
  });

  it('still requires specific permissions when a handler declares one', async () => {
    const guard = guardWithUser(
      { roles: [], service_permissions: { WEBHARD_SERVICE: ['READ'] } },
      'WRITE',
    );

    await expect(guard.canActivate(contextWithAuth())).rejects.toThrow('권한이 없습니다.');
  });
});

function guardWithUser(currentUser: Record<string, unknown>, requiredPermission?: string): AuthGuard {
  const reflector = {
    getAllAndOverride: jest.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(requiredPermission),
  };
  const adminServiceClient = {
    fetchCurrentUser: jest.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({
      user_id: 'USER1',
      ...currentUser,
    }),
  };
  return new AuthGuard(reflector as any, adminServiceClient as any);
}

function contextWithAuth(): ExecutionContext {
  const request = {
    method: 'POST',
    header: jest.fn((name: string) => {
      if (name.toLowerCase() === 'authorization') {
        return 'Bearer token';
      }
      return '';
    }),
  };
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}
