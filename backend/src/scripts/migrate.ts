import 'dotenv/config';
import { loadConfig } from '../config.js';
import { createPgDatabase } from '../db.js';
import { runMigrations } from '../migrate.js';

const config = loadConfig();
const db = createPgDatabase(config.databaseUrl);

try {
  const applied = await runMigrations(db, config.migrationsDir);
  console.log(applied.length > 0 ? `Applied: ${applied.join(', ')}` : 'No pending migrations.');
} finally {
  await db.close();
}
