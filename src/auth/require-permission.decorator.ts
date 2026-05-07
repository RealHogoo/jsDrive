import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';
export const RequirePermission = (permissionCode: string): ReturnType<typeof SetMetadata> =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permissionCode);
