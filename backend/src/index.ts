import 'dotenv/config';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPgDatabase } from './db.js';

const config = loadConfig();
const db = createPgDatabase(config.databaseUrl);
const app = await buildApp({ config, db });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
