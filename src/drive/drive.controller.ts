import { Body, Controller, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ok } from '../common/api-response';
import { traceId } from '../common/request-util';
import { DriveService } from './drive.service';
import { IndexingService } from './indexing.service';

@Controller()
export class DriveController {
  constructor(
    private readonly driveService: DriveService,
    private readonly indexingService: IndexingService,
  ) {}

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

  @RequirePermission('WRITE')
  @Post('file/upload.json')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 * 1024 } }))
  async uploadFile(
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: Express.Multer.File,
    @Req() request: Request,
  ) {
    return ok(await this.driveService.uploadFile(body, file, viewer(request)), traceId(request));
  }

  @Post('preview/list.json')
  async previewList(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.previewList(body, viewer(request)), traceId(request));
  }

  @RequirePermission('SHARE')
  @Post('share/create.json')
  async createShare(@Body() body: Record<string, unknown>, @Req() request: Request) {
    return ok(await this.driveService.createShare(body, viewer(request)), traceId(request));
  }

  @RequirePermission('WRITE')
  @Post('index/start.json')
  async startIndex(@Req() request: Request) {
    return ok(await this.indexingService.start(viewer(request)), traceId(request));
  }

  @Post('index/status.json')
  async indexStatus(@Req() request: Request) {
    return ok(await this.indexingService.status(viewer(request)), traceId(request));
  }
}

function viewer(request: Request) {
  const currentUser = request.auth?.currentUser;
  return {
    userId: currentUser?.user_id || '',
    roles: currentUser?.roles || [],
  };
}
