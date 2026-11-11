import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openApp } from './compose';
import { buildServer, VERSION } from './server';
import { licenceKey, SystemService } from './system';

/** Starts the Hub: O_DATA_DIR (database folder), O_BACKUP_DIR (default <data>/backups), O_REQUIRE_LICENCE=1 (read-only without a valid licence), O_PORT (default 4870), O_HOST (default 127.0.0.1: only this PC; 0.0.0.0 opens it to the shop network), O_WEB_DIR (built screens), O_TEST_MODE=1 (test server: allows loading test data), O_TEST_STAFF_SECRET (password for the test staff accounts), O_BRANCH_ID. */
const env = process.env;
const dataDir = env.O_DATA_DIR ?? join(process.cwd(), 'data'); mkdirSync(dataDir, { recursive: true });
const app = openApp({ branchId: env.O_BRANCH_ID ?? 'B1', dbPath: join(dataDir, 'o-pharmacy.db'), testMode: env.O_TEST_MODE === '1' });
const port = Number(env.O_PORT ?? 4870), host = env.O_HOST ?? '127.0.0.1';
const system = new SystemService(app, { dataDir, backupDir: env.O_BACKUP_DIR, requireLicence: env.O_REQUIRE_LICENCE === '1', licencePublicKey: licenceKey(), port, host }); system.startSchedule();
const server = buildServer(app, { webDir: env.O_WEB_DIR, staffSecret: env.O_TEST_STAFF_SECRET, logger: env.O_LOG === '1', system });
server.listen({ port, host }).then(() => console.log(`O Pharmacy Hub ${VERSION} on http://${host}:${port} (data: ${dataDir}${app.testMode ? ', TEST MODE' : ''})`)).catch(e => { console.error(e); process.exit(1); });
const stop = () => { system.stop(); server.close().finally(() => { app.hub.close(); process.exit(0); }); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
