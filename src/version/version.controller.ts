import { Controller, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ok } from '../common/api-response';
import { VersionService } from './version.service';

@Controller()
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  @Public()
  @Post('version.json')
  version() {
    return ok(this.versionService.version());
  }
}
