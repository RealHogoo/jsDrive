import { HttpStatus } from '@nestjs/common';
import { ApiCode } from './api-code';

export class ApiException extends Error {
  constructor(
    readonly code: ApiCode,
    readonly status: HttpStatus,
    message: string,
  ) {
    super(message);
  }

  static badRequest(message: string): ApiException {
    return new ApiException(ApiCode.BAD_REQUEST, HttpStatus.BAD_REQUEST, message);
  }
}
