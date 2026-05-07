const WEBHARD_SERVICE = 'WEBHARD_SERVICE';

export function isAdmin(roles: string[]): boolean {
  return roles.includes('ROLE_ADMIN') || roles.includes('ROLE_SUPER_ADMIN');
}

export function hasPermission(
  permissions: Record<string, string[]>,
  permissionCode: string,
): boolean {
  const items = permissions[WEBHARD_SERVICE] || permissions['WEBHARD-SERVICE'];
  return Array.isArray(items) && items.includes(normalizeCode(permissionCode));
}

export function normalizeCode(value: string): string {
  return value.trim().replace(/[- ]/g, '_').toUpperCase();
}
