import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminModule } from './integration/admin/admin.module';
import { AuthGuard } from './auth/auth.guard';
import { DatabaseModule } from './database/database.module';
import { DriveModule } from './drive/drive.module';
import { HealthModule } from './health/health.module';
import { VersionModule } from './version/version.module';

@Module({
  imports: [AdminModule, DatabaseModule, DriveModule, HealthModule, VersionModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
