import { Controller, Post, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ok } from '../common/api-response';
import { storageHealth } from '../common/storage-path';
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
    const storage = storageHealth();
    if (storage.status !== 'UP') {
      throw new ServiceUnavailableException({
        ok: false,
        code: 'STORAGE_UNAVAILABLE',
        message: 'webhard storage is not available',
        data: { status: 'DOWN', service: serviceId(), db: 'UP', storage },
        trace_id: null,
      });
    }
    return ok({ status: 'UP', service: serviceId(), db: 'UP', storage });
  }

  @Public()
  @Post('status.json')
  async status() {
    let db = 'UP';
    try {
      await this.databaseService.ping();
    } catch (_exception) {
      db = 'DOWN';
    }
    const storage = storageHealth();
    return ok({
      status: db === 'UP' && storage.status === 'UP' ? 'UP' : 'DOWN',
      service: serviceId(),
      db,
      storage,
    });
  }
}

function serviceId(): string {
  return process.env.SERVICE_ID || 'webhard-service';
}
