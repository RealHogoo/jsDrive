import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { ok } from '../common/api-response';
import { traceId } from '../common/request-util';
import { TranscodeService } from './transcode.service';

@Controller()
export class TranscodeController {
  constructor(private readonly transcodeService: TranscodeService) {}

  @Post('transcode/file/start.json')
  async startFile(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.transcodeService.enqueueFile(body, viewer(request)), traceId(request));
  }

  @Post('transcode/pending/start.json')
  async startPending(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.transcodeService.enqueuePending(body, viewer(request)), traceId(request));
  }

  @Post('transcode/status.json')
  async status(@Body() body: Record<string, unknown> = {}, @Req() request: Request) {
    return ok(await this.transcodeService.status(body, viewer(request)), traceId(request));
  }
}

function viewer(request: Request) {
  const currentUser = request.auth?.currentUser;
  return {
    userId: currentUser?.user_id || '',
    roles: currentUser?.roles || [],
  };
}
