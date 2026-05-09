import { Module } from '@nestjs/common';
import { DriveController } from './drive.controller';
import { DriveService } from './drive.service';
import { IndexingService } from './indexing.service';

@Module({
  controllers: [DriveController],
  providers: [DriveService, IndexingService],
})
export class DriveModule {}
