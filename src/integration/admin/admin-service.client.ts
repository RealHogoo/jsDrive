import { Injectable } from '@nestjs/common';

export interface CurrentUser {
  user_id: string;
  session_id?: string;
  roles: string[];
  service_permissions: Record<string, string[]>;
}

interface CachedCurrentUser {
  currentUser: CurrentUser;
  expiresAtMillis: number;
}

@Injectable()
export class AdminServiceClient {
  private readonly adminServiceBaseUrl = trimTrailingSlash(
    process.env.ADMIN_SERVICE_BASE_URL || 'http://localhost:8081',
  );
  private readonly cache = new Map<string, CachedCurrentUser>();

  async fetchCurrentUser(accessToken: string): Promise<CurrentUser | null> {
    const token = accessToken.trim();
    if (!token) {
      return null;
    }

    const now = Date.now();
    const cached = this.cache.get(token);
    if (cached && cached.expiresAtMillis > now) {
      return cloneCurrentUser(cached.currentUser);
    }

    const response = await fetch(`${this.adminServiceBaseUrl}/auth/me.json`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    if (!response.ok) {
      this.cache.delete(token);
      return null;
    }

    const body = (await response.json()) as {
      ok?: boolean;
      data?: Partial<CurrentUser>;
    };
    if (body.ok !== true || !body.data || !body.data.user_id) {
      this.cache.delete(token);
      return null;
    }

    const currentUser: CurrentUser = {
      user_id: String(body.data.user_id),
      session_id: body.data.session_id ? String(body.data.session_id) : undefined,
      roles: Array.isArray(body.data.roles) ? body.data.roles.map(String) : [],
      service_permissions: normalizePermissions(body.data.service_permissions),
    };
    this.cache.set(token, {
      currentUser,
      expiresAtMillis: now + 5000,
    });
    return cloneCurrentUser(currentUser);
  }
}

function trimTrailingSlash(value: string): string {
  let normalized = value.trim();
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function normalizePermissions(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const result: Record<string, string[]> = {};
  for (const [serviceCode, permissions] of Object.entries(raw)) {
    if (!Array.isArray(permissions)) {
      continue;
    }
    result[normalizeCode(serviceCode)] = permissions.map((item) => normalizeCode(String(item)));
  }
  return result;
}

function normalizeCode(value: string): string {
  return value.trim().replace(/[- ]/g, '_').toUpperCase();
}

function cloneCurrentUser(currentUser: CurrentUser): CurrentUser {
  return {
    ...currentUser,
    roles: [...currentUser.roles],
    service_permissions: Object.fromEntries(
      Object.entries(currentUser.service_permissions).map(([key, value]) => [key, [...value]]),
    ),
  };
}
