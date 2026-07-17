import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

export interface CurrentUser {
  user_id: string;
  session_id?: string;
  roles: string[];
  service_permissions: Record<string, string[]>;
}

export interface ServiceStatus {
  service_cd: string;
  use_yn: string;
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
  private readonly internalApiToken = internalApiToken();
  private readonly cache = new Map<string, CachedCurrentUser>();
  private readonly cacheMaxEntries = authCacheMaxEntries();

  async fetchCurrentUser(accessToken: string): Promise<CurrentUser | null> {
    const token = accessToken.trim();
    if (!token) {
      return null;
    }

    const now = Date.now();
    const cacheKey = authCacheKey(token);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAtMillis > now) {
      return cloneCurrentUser(cached.currentUser);
    }
    if (cached) {
      this.cache.delete(cacheKey);
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
      this.cache.delete(cacheKey);
      return null;
    }

    const body = (await response.json()) as {
      ok?: boolean;
      data?: Partial<CurrentUser>;
    };
    if (body.ok !== true || !body.data || !body.data.user_id) {
      this.cache.delete(cacheKey);
      return null;
    }

    const currentUser: CurrentUser = {
      user_id: String(body.data.user_id),
      session_id: body.data.session_id ? String(body.data.session_id) : undefined,
      roles: Array.isArray(body.data.roles) ? body.data.roles.map(String) : [],
      service_permissions: normalizePermissions(body.data.service_permissions),
    };
    this.pruneCache(now);
    this.cache.set(cacheKey, {
      currentUser,
      expiresAtMillis: now + 5000,
    });
    return cloneCurrentUser(currentUser);
  }

  private pruneCache(now = Date.now()): void {
    for (const [key, value] of this.cache) {
      if (value.expiresAtMillis <= now) {
        this.cache.delete(key);
      }
    }
    const overflow = this.cache.size - this.cacheMaxEntries + 1;
    if (overflow <= 0) {
      return;
    }
    const oldest = [...this.cache.entries()]
      .sort((left, right) => left[1].expiresAtMillis - right[1].expiresAtMillis)
      .slice(0, overflow);
    for (const [key] of oldest) {
      this.cache.delete(key);
    }
  }

  async fetchServiceStatus(_accessToken: string | null | undefined, serviceCode: string): Promise<ServiceStatus | null> {
    const targetServiceCode = normalizeCode(serviceCode);
    if (!targetServiceCode || !this.internalApiToken) {
      return null;
    }

    let response: Response;
    try {
      response = await fetch(`${this.adminServiceBaseUrl}/internal/service/use-status.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Api-Token': this.internalApiToken,
        },
        body: JSON.stringify({ service_cd: serviceRegistryCode(targetServiceCode) }),
      });
    } catch (_exception) {
      return null;
    }
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as {
      ok?: boolean;
      data?: unknown;
    };
    if (body.ok !== true || !body.data || typeof body.data !== 'object') {
      return null;
    }
    const row = body.data as Record<string, unknown>;
    if (normalizeCode(String(row.service_cd || '')) !== targetServiceCode) {
      return null;
    }
    return {
      service_cd: String(row.service_cd || ''),
      use_yn: String(row.use_yn || ''),
    };
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

function authCacheKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function authCacheMaxEntries(): number {
  const parsed = Number(process.env.ADMIN_AUTH_CACHE_MAX_ENTRIES || '500');
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 500;
}

function serviceRegistryCode(value: string): string {
  return normalizeCode(value).toLowerCase().replace(/_/g, '-');
}

function internalApiToken(): string {
  const configured = String(process.env.ADMIN_INTERNAL_API_TOKEN || process.env.MEDIA_INTERNAL_API_TOKEN || '').trim();
  if (configured) {
    return configured;
  }
  return String(process.env.APP_ENV || 'dev').toLowerCase() === 'prod' ? '' : 'dev-media-internal-token';
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
