import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({
    host: process.env.WEBHARD_DB_HOST || 'localhost',
    port: Number(process.env.WEBHARD_DB_PORT || 5432),
    database: process.env.WEBHARD_DB_DATABASE || 'webhard',
    user: process.env.WEBHARD_DB_USERNAME || 'postgres',
    password: process.env.WEBHARD_DB_PASSWORD || 'postgres',
    max: Number(process.env.WEBHARD_DB_POOL_SIZE || 10),
  });

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
