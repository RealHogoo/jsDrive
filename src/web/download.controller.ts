import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { ok } from '../common/api-response';
import { traceId } from '../common/request-util';
import { DownloadJobService } from './download-job.service';

@Controller()
export class DownloadController {
  constructor(private readonly downloadJobService: DownloadJobService) {}

  @Post('download/week/start.json')
  async startWeekDownload(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.downloadJobService.startWeekDownload(body, viewer(request)), traceId(request));
  }

  @Post('download/status.json')
  async status(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.downloadJobService.status(body, viewer(request)), traceId(request));
  }

  @Post('download/list.json')
  async list(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.downloadJobService.list(body, viewer(request)), traceId(request));
  }
}

function viewer(request: Request) {
  return {
    userId: request.auth?.currentUser?.user_id || '',
  };
}
