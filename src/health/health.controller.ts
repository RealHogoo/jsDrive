import { Controller, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ok } from '../common/api-response';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Public()
  @Post('live.json')
  live() {
    return ok({ status: 'UP', service: serviceId() });
  }

  @Public()
  @Post('ready.json')
  async ready() {
    await this.databaseService.ping();
    return ok({ status: 'UP', service: serviceId(), db: 'UP' });
  }

  @Public()
  @Post('status.json')
  async status() {
    let db = 'UP';
    try {
      await this.databaseService.ping();
    } catch (exception) {
      db = 'DOWN';
    }
    return ok({
      status: db === 'UP' ? 'UP' : 'DOWN',
      service: serviceId(),
      db,
      env: process.env.APP_ENV || 'dev',
    });
  }
}

function serviceId(): string {
  return process.env.SERVICE_ID || 'webhard-service';
}
