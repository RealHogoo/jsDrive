import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NextFunction, Request, Response } from 'express';
import { static as serveStatic } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.use('/assets', serveStatic(join(process.cwd(), 'public'), {
    etag: true,
    maxAge: '5m',
  }));
  const port = Number(process.env.PORT || 8083);
  await app.listen(port);
}

void bootstrap();
