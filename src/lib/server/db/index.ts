import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { building } from '$app/env';
import { DATA_DIR } from '$app/env/private';
import * as schema from './schema';

// `vite build` imports this to analyse the app: don't touch the real database then.
if (!building) mkdirSync(DATA_DIR, { recursive: true });
const client = createClient({
	url: building ? ':memory:' : `file:${path.join(DATA_DIR, 'app.db')}`
});

export const db = drizzle(client, { schema });

/** Connection settings, then the migrations in `drizzle/` (from `pnpm db:generate`). */
export async function initDb() {
	await client.execute('PRAGMA foreign_keys = ON');
	await client.execute('PRAGMA journal_mode = WAL');
	await migrate(db, { migrationsFolder: 'drizzle' });
}
