import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  const port = Number(process.env.PORT || 8083);
  await app.listen(port);
}

void bootstrap();
