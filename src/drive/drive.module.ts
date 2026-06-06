import { Module } from '@nestjs/common';
import { AdminModule } from '../integration/admin/admin.module';
import { DriveController } from './drive.controller';
import { DriveService } from './drive.service';
import { InternalMediaController } from './internal-media.controller';
import { IndexingService } from './indexing.service';

@Module({
  imports: [AdminModule],
  controllers: [DriveController, InternalMediaController],
  providers: [DriveService, IndexingService],
})
export class DriveModule {}
