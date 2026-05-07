import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { static as serveStatic } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.use('/assets', serveStatic(join(process.cwd(), 'public')));
  app.use('/storage', serveStatic(join(process.cwd(), process.env.WEBHARD_STORAGE_DIR || 'storage')));
  const port = Number(process.env.PORT || 8083);
  await app.listen(port);
}

void bootstrap();
