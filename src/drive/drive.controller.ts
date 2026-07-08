import { Body, Controller, Post, Req, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { Request } from 'express';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import { extname } from 'path';
import { RequirePermission } from '../auth/require-permission.decorator';
import { hasAnyWebhardPermission, hasPermission, isAdmin } from '../auth/permission.util';
import { ok } from '../common/api-response';
import { traceId } from '../common/request-util';
import { uploadLimits } from '../common/upload-limit';
import { DriveService } from './drive.service';
import { IndexingService } from './indexing.service';

const UPLOAD_LIMITS = uploadLimits();
const UPLOAD_STORAGE = diskStorage({
  destination: tmpdir(),
  filename: (_request, file, callback) => {
    callback(null, `webhard-upload-${randomUUID()}${extname(file.originalname || '')}`);
  },
});

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

  @Post('folder/tree.json')
  async folderTree(@Req() request: Request) {
    return ok(await this.driveService.folderTree(viewer(request)), traceId(request));
  }

  @RequirePermission('WRITE')
  @Post('folder/save.json')
  async saveFolder(@Body() body: Record<string, unknown>, @Req() request: Request) {
    return ok(await this.driveService.saveFolder(body, viewer(request)), traceId(request));
  }

  @RequirePermission('WRITE')
  @Post('folder/move.json')
  async moveFolder(@Body() body: Record<string, unknown>, @Req() request: Request) {
    return ok(await this.driveService.moveFolder(body, viewer(request)), traceId(request));
  }

  @Post('file/list.json')
  async fileList(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.fileList(body, viewer(request)), traceId(request));
  }

  @Post('file/search.json')
  async searchFiles(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.searchFiles(body, viewer(request)), traceId(request));
  }

  @Post('file/detail.json')
  async fileDetail(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.fileDetail(body, viewer(request)), traceId(request));
  }

  @RequirePermission('WRITE')
  @Post('file/metadata.json')
  async fileMetadata(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.updateFileMetadata(body, viewer(request)), traceId(request));
  }

  @RequirePermission('WRITE')
  @Post('file/move.json')
  async moveFile(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.moveFile(body, viewer(request)), traceId(request));
  }

  @Post('file/duplicates.json')
  async duplicateFiles(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.duplicates(body, viewer(request)), traceId(request));
  }

  @RequirePermission('WRITE')
  @Post('file/hash-backfill.json')
  async hashBackfill(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.backfillHashes(body, viewer(request)), traceId(request));
  }

  @Post('dashboard/summary.json')
  async dashboardSummary(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.dashboardSummary(body, viewer(request)), traceId(request));
  }

  @Post('me.json')
  async currentUser(@Req() request: Request) {
    const currentUser = request.auth?.currentUser;
    const roles = currentUser?.roles || [];
    const servicePermissions = currentUser?.service_permissions || {};
    return ok({
      user_id: currentUser?.user_id || '',
      roles,
      is_admin: isAdmin(roles),
      permissions: {
        any: isAdmin(roles) || hasAnyWebhardPermission(servicePermissions),
        write: isAdmin(roles) || hasPermission(servicePermissions, 'WRITE'),
        delete: isAdmin(roles) || hasPermission(servicePermissions, 'DELETE'),
        share: isAdmin(roles) || hasPermission(servicePermissions, 'SHARE'),
      },
    }, traceId(request));
  }

  @RequirePermission('DELETE')
  @Post('file/delete.json')
  async deleteFile(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.deleteFile(body, viewer(request)), traceId(request));
  }

  @Post('file/delete-week.json')
  async deleteWeekFiles(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.deleteWeekFiles(body, viewer(request)), traceId(request));
  }

  @Post('file/change-owner-week.json')
  async changeWeekOwner(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.changeWeekOwner(body, viewer(request)), traceId(request));
  }

  @Post('trash/list.json')
  async trashList(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.trashList(body, viewer(request)), traceId(request));
  }

  @RequirePermission('DELETE')
  @Post('trash/restore.json')
  async trashRestore(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.restoreFile(body, viewer(request)), traceId(request));
  }

  @RequirePermission('DELETE')
  @Post('trash/purge.json')
  async trashPurge(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.purgeFile(body, viewer(request)), traceId(request));
  }

  @RequirePermission('DELETE')
  @Post('trash/purge-old.json')
  async trashPurgeOld(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.purgeOldTrash(body, viewer(request)), traceId(request));
  }

  @RequirePermission('WRITE')
  @Post('file/register.json')
  async registerFile(@Body() body: Record<string, unknown>, @Req() request: Request) {
    return ok(await this.driveService.registerFile(body, viewer(request)), traceId(request));
  }

  @RequirePermission('WRITE')
  @Post('file/upload.json')
  @UseInterceptors(FileInterceptor('file', {
    storage: UPLOAD_STORAGE,
    limits: { fileSize: UPLOAD_LIMITS.maxFileBytes },
  }))
  async uploadFile(
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: Express.Multer.File,
    @Req() request: Request,
  ) {
    return ok(await this.driveService.uploadFile(body, file, viewer(request)), traceId(request));
  }

  @RequirePermission('WRITE')
  @Post('file/upload-batch.json')
  @UseInterceptors(FilesInterceptor('files', 100, {
    storage: UPLOAD_STORAGE,
    limits: { fileSize: UPLOAD_LIMITS.maxFileBytes },
  }))
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

  @Post('share/list.json')
  async shareList(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.shareList(body, viewer(request)), traceId(request));
  }

  @RequirePermission('SHARE')
  @Post('share/revoke.json')
  async revokeShare(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.revokeShare(body, viewer(request)), traceId(request));
  }

  @Post('audit/list.json')
  async auditList(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.auditList(body, viewer(request)), traceId(request));
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

  @RequirePermission('WRITE')
  @Post('thumbnail/rebuild.json')
  async thumbnailRebuild(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.driveService.rebuildThumbnails(body, viewer(request)), traceId(request));
  }
}

function viewer(request: Request) {
  const currentUser = request.auth?.currentUser;
  return {
    userId: currentUser?.user_id || '',
    roles: currentUser?.roles || [],
  };
}
