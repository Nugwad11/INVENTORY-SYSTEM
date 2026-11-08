import 'dotenv/config';
import { loadConfig } from '../config.js';
import { createPgDatabase } from '../db.js';
import { seedDatabase } from '../seed.js';

const config = loadConfig();
const db = createPgDatabase(config.databaseUrl);

try {
  const result = await seedDatabase(db, config.seedPassword);
  console.log(result.skipped ? 'Database already seeded.' : 'Seed complete.');
} finally {
  await db.close();
}
