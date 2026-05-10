import { Body, Controller, Post, Req, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ok } from '../common/api-response';
import { traceId } from '../common/request-util';
import { uploadLimits } from '../common/upload-limit';
import { DriveService } from './drive.service';
import { IndexingService } from './indexing.service';

const UPLOAD_LIMITS = uploadLimits();

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

  @Post('file/detail.json')
  async fileDetail(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.fileDetail(body, viewer(request)), traceId(request));
  }

  @RequirePermission('WRITE')
  @Post('file/register.json')
  async registerFile(@Body() body: Record<string, unknown>, @Req() request: Request) {
    return ok(await this.driveService.registerFile(body, viewer(request)), traceId(request));
  }

  @RequirePermission('WRITE')
  @Post('file/upload.json')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMITS.maxFileBytes } }))
  async uploadFile(
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: Express.Multer.File,
    @Req() request: Request,
  ) {
    return ok(await this.driveService.uploadFile(body, file, viewer(request)), traceId(request));
  }

  @RequirePermission('WRITE')
  @Post('file/upload-batch.json')
  @UseInterceptors(FilesInterceptor('files', 100, { limits: { fileSize: UPLOAD_LIMITS.maxFileBytes } }))
  async uploadFiles(
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() request: Request,
  ) {
    return ok(await this.driveService.uploadFiles(body, files, viewer(request)), traceId(request));
  }

  @Post('preview/list.json')
  async previewList(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.previewList(body, viewer(request)), traceId(request));
  }

  @Post('preview/feed.json')
  async previewFeed(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.previewFeed(body, viewer(request)), traceId(request));
  }

  @Post('preview/week-items.json')
  async previewWeekItems(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.previewWeekItems(body, viewer(request)), traceId(request));
  }

  @Post('upload/limits.json')
  async uploadLimitInfo(@Req() request: Request) {
    return ok(this.driveService.uploadLimitInfo(), traceId(request));
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
