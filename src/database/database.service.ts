import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool(databaseConfig());

  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, params);
  }

  async ping(): Promise<boolean> {
    await this.query('SELECT 1');
    return true;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

function databaseConfig(): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max: number;
} {
  if (isProductionEnv() && !process.env.WEBHARD_DB_PASSWORD) {
    throw new Error('WEBHARD_DB_PASSWORD is required in production');
  }
  return {
    host: process.env.WEBHARD_DB_HOST || 'localhost',
    port: Number(process.env.WEBHARD_DB_PORT || 5432),
    database: process.env.WEBHARD_DB_DATABASE || 'webhard',
    user: process.env.WEBHARD_DB_USERNAME || 'postgres',
    password: process.env.WEBHARD_DB_PASSWORD || 'postgres',
    max: Number(process.env.WEBHARD_DB_POOL_SIZE || 10),
  };
}

function isProductionEnv(): boolean {
  const appEnv = String(process.env.APP_ENV || process.env.NODE_ENV || '').trim().toLowerCase();
  return appEnv === 'prod' || appEnv === 'production';
}
