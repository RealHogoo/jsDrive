import { Module } from '@nestjs/common';
import { AdminModule } from '../integration/admin/admin.module';
import { WebController } from './web.controller';

@Module({
  imports: [AdminModule],
  controllers: [WebController],
})
export class WebModule {}
