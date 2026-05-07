import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { bearerToken } from '../common/request-util';
import { AdminServiceClient } from '../integration/admin/admin-service.client';
import { IS_PUBLIC_KEY } from './public.decorator';
import { REQUIRED_PERMISSION_KEY } from './require-permission.decorator';
import { hasPermission, isAdmin } from './permission.util';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly adminServiceClient: AdminServiceClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    if (request.method.toUpperCase() !== 'POST') {
      throw new ForbiddenException('허용되지 않은 요청 방식입니다.');
    }

    const accessToken = bearerToken(request);
    if (!accessToken) {
      throw new UnauthorizedException('로그인이 필요합니다.');
    }

    const currentUser = await this.adminServiceClient.fetchCurrentUser(accessToken);
    if (!currentUser) {
      throw new UnauthorizedException('로그인 정보가 유효하지 않습니다.');
    }

    request.auth = { accessToken, currentUser };
    const requiredPermission = this.reflector.getAllAndOverride<string>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredPermission && !isAdmin(currentUser.roles) && !hasPermission(currentUser.service_permissions, requiredPermission)) {
      throw new ForbiddenException('권한이 없습니다. 관리자에게 웹하드 접근 권한 설정을 요청하세요.');
    }

    return true;
  }
}
