import { PGlite } from '@electric-sql/pglite';
import type { Database, Queryable } from '../../src/db.js';

export async function createTestDatabase(): Promise<Database> {
  const pg = new PGlite();
  await pg.waitReady;

  const query = async <T>(text: string, params: unknown[] = []) => {
    // PGlite's extended-protocol query rejects multi-statement text; migrations use exec.
    if (params.length === 0 && text.trim().replace(/;+\s*$/, '').includes(';')) {
      await pg.exec(text);
      return { rows: [] as T[] };
    }
    const result = await pg.query<T>(text, params);
    return { rows: result.rows };
  };

  const db: Database = {
    query,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      await pg.exec('begin');
      try {
        const result = await fn({ query });
        await pg.exec('commit');
        return result;
      } catch (error) {
        await pg.exec('rollback').catch(() => undefined);
        throw error;
      }
    },
    async close() {
      await pg.close();
    },
  };

  return db;
}
