import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { loadConfig } from '@qgen/config';

import { createSqliteDb } from './client.ts';

const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');
const config = loadConfig();
const dbPath = resolve(config.dataDir, 'qgen.db');

const { sqlite, db } = createSqliteDb(dbPath);
migrate(db, { migrationsFolder });
sqlite.close();

console.log(`[db] migrated ${dbPath}`);
