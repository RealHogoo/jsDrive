import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { authTokenWithSource, isCrossSiteRequest } from '../common/request-util';
import { AdminServiceClient } from '../integration/admin/admin-service.client';
import { IS_PUBLIC_KEY } from './public.decorator';
import { REQUIRED_PERMISSION_KEY } from './require-permission.decorator';
import { WEBHARD_SERVICE, hasAnyWebhardPermission, hasPermission, isAdmin } from './permission.util';

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

    const { token: accessToken, source } = authTokenWithSource(request);
    if (!accessToken) {
      throw new UnauthorizedException('로그인이 필요합니다.');
    }
    if (source === 'cookie' && isCrossSiteRequest(request)) {
      throw new ForbiddenException('인증 쿠키를 사용할 수 없는 요청입니다.');
    }

    const currentUser = await this.adminServiceClient.fetchCurrentUser(accessToken);
    if (!currentUser) {
      throw new UnauthorizedException('로그인 정보가 유효하지 않습니다.');
    }

    request.auth = { accessToken, currentUser };
    const serviceStatus = await this.adminServiceClient.fetchServiceStatus(accessToken, WEBHARD_SERVICE);
    if (serviceStatus?.use_yn.toUpperCase() === 'N') {
      throw new ForbiddenException('웹하드 서비스가 관리자에 의해 비활성화되었습니다.');
    }

    const requiredPermission = this.reflector.getAllAndOverride<string>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isAdmin(currentUser.roles) && !hasAnyWebhardPermission(currentUser.service_permissions)) {
      throw new ForbiddenException('웹하드 접근 권한이 없습니다. 관리자에게 접근 권한 설정을 요청하세요.');
    }
    if (requiredPermission && !isAdmin(currentUser.roles) && !hasPermission(currentUser.service_permissions, requiredPermission)) {
      throw new ForbiddenException('권한이 없습니다. 관리자에게 웹하드 접근 권한 설정을 요청하세요.');
    }

    return true;
  }
}
