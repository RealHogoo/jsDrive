import { Module } from '@nestjs/common';
import { AdminModule } from '../integration/admin/admin.module';
import { DatabaseModule } from '../database/database.module';
import { DownloadController } from './download.controller';
import { DownloadJobService } from './download-job.service';
import { WebController } from './web.controller';

@Module({
  imports: [AdminModule, DatabaseModule],
  controllers: [WebController, DownloadController],
  providers: [DownloadJobService],
})
export class WebModule {}
