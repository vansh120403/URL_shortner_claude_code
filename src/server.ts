import 'dotenv/config';
import './silenceWarnings';
import { config } from './config';
import { getDb } from './db';
import { createApp } from './app';

const db = getDb(config.databasePath);
const app = createApp({ db });

const server = app.listen(config.port, () => {
  console.log(`URL shortener listening at ${config.baseUrl} (port ${config.port})`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down gracefully...`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    console.log('Closed cleanly.');
    process.exit(0);
  });
  // Force-exit if connections don't drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});
