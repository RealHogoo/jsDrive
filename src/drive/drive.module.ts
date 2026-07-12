import { Module } from '@nestjs/common';
import { AdminModule } from '../integration/admin/admin.module';
import { DriveController } from './drive.controller';
import { DriveService } from './drive.service';
import { InternalMediaController } from './internal-media.controller';
import { IndexingService } from './indexing.service';
import { TranscodeController } from './transcode.controller';
import { TranscodeService } from './transcode.service';

@Module({
  imports: [AdminModule],
  controllers: [DriveController, InternalMediaController, TranscodeController],
  providers: [DriveService, IndexingService, TranscodeService],
})
export class DriveModule {}
