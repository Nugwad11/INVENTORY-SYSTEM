import fs from 'node:fs/promises';
import path from 'node:path';
import type { Database } from './db.js';

export async function runMigrations(db: Database, migrationsDir: string): Promise<string[]> {
  await db.query(`
    create table if not exists schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    const existing = await db.query('select 1 from schema_migrations where filename = $1', [file]);
    if (existing.rows.length > 0) continue;

    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    await db.transaction(async (tx) => {
      await tx.query(sql);
      await tx.query('insert into schema_migrations (filename) values ($1)', [file]);
    });
    applied.push(file);
  }

  return applied;
}
