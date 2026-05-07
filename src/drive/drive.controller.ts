import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ok } from '../common/api-response';
import { traceId } from '../common/request-util';
import { DriveService } from './drive.service';

@Controller()
export class DriveController {
  constructor(private readonly driveService: DriveService) {}

  @Post('folder/list.json')
  async folderList(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.folderList(body, viewer(request)), traceId(request));
  }

  @RequirePermission('WRITE')
  @Post('folder/save.json')
  async saveFolder(@Body() body: Record<string, unknown>, @Req() request: Request) {
    return ok(await this.driveService.saveFolder(body, viewer(request)), traceId(request));
  }

  @Post('file/list.json')
  async fileList(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.fileList(body, viewer(request)), traceId(request));
  }

  @RequirePermission('WRITE')
  @Post('file/register.json')
  async registerFile(@Body() body: Record<string, unknown>, @Req() request: Request) {
    return ok(await this.driveService.registerFile(body, viewer(request)), traceId(request));
  }

  @RequirePermission('SHARE')
  @Post('share/create.json')
  async createShare(@Body() body: Record<string, unknown>, @Req() request: Request) {
    return ok(await this.driveService.createShare(body, viewer(request)), traceId(request));
  }
}

function viewer(request: Request) {
  const currentUser = request.auth?.currentUser;
  return {
    userId: currentUser?.user_id || '',
    roles: currentUser?.roles || [],
  };
}
