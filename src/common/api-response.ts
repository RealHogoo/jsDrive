import { ApiCode } from './api-code';

export interface ApiResponseBody<T> {
  ok: boolean;
  code: ApiCode | string;
  message: string;
  data: T | null;
  trace_id: string | null;
}

export function ok<T>(data: T, traceId: string | null = null): ApiResponseBody<T> {
  return {
    ok: true,
    code: ApiCode.OK,
    message: 'success',
    data,
    trace_id: traceId,
  };
}

export function fail<T = null>(
  code: ApiCode | string,
  message: string,
  data: T | null = null,
  traceId: string | null = null,
): ApiResponseBody<T> {
  return {
    ok: false,
    code,
    message,
    data,
    trace_id: traceId,
  };
}
