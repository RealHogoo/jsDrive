import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiCode } from './api-code';
import { ApiException } from './api-exception';
import { fail } from './api-response';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof ApiException) {
      response
        .status(exception.status)
        .json(fail(exception.code, exception.message));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response
        .status(status)
        .json(fail(codeForStatus(status), exception.message || 'request failed'));
      return;
    }

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(fail(ApiCode.SERVER_ERROR, 'server error'));
  }
}

function codeForStatus(status: number): ApiCode {
  if (status === HttpStatus.UNAUTHORIZED) {
    return ApiCode.UNAUTHORIZED;
  }
  if (status === HttpStatus.FORBIDDEN) {
    return ApiCode.FORBIDDEN;
  }
  if (status === HttpStatus.NOT_FOUND) {
    return ApiCode.NOT_FOUND;
  }
  if (status === HttpStatus.BAD_REQUEST) {
    return ApiCode.BAD_REQUEST;
  }
  return ApiCode.SERVER_ERROR;
}
