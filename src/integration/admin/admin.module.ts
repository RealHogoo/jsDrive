import { Module } from '@nestjs/common';
import { AdminServiceClient } from './admin-service.client';

@Module({
  providers: [AdminServiceClient],
  exports: [AdminServiceClient],
})
export class AdminModule {}
