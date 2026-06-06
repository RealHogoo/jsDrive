const WEBHARD_SERVICE = 'WEBHARD_SERVICE';

export { WEBHARD_SERVICE };

export function isAdmin(roles: string[]): boolean {
  return roles.includes('ROLE_ADMIN') || roles.includes('ROLE_SUPER_ADMIN');
}

export function hasPermission(
  permissions: Record<string, string[]>,
  permissionCode: string,
): boolean {
  return hasServicePermission(permissions, WEBHARD_SERVICE, permissionCode);
}

export function hasAnyWebhardPermission(permissions: Record<string, string[]>): boolean {
  return hasAnyServicePermission(permissions, WEBHARD_SERVICE);
}

export function hasServicePermission(
  permissions: Record<string, string[]>,
  serviceCode: string,
  permissionCode: string,
): boolean {
  const items = permissionItems(permissions, serviceCode);
  return Array.isArray(items) && items.includes(normalizeCode(permissionCode));
}

export function hasAnyServicePermission(permissions: Record<string, string[]>, serviceCode: string): boolean {
  const items = permissionItems(permissions, serviceCode);
  return Array.isArray(items) && items.length > 0;
}

function permissionItems(permissions: Record<string, string[]>, serviceCode: string): string[] | undefined {
  const normalized = normalizeCode(serviceCode);
  return permissions[normalized] || permissions[normalized.replace(/_/g, '-')];
}

export function normalizeCode(value: string): string {
  return value.trim().replace(/[- ]/g, '_').toUpperCase();
}
