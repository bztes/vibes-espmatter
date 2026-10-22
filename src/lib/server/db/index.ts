import { mkdirSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from './schema';
import { databasePath } from './path';
import { building } from '$app/env';
import { DATA_DIR } from '$app/env/private';

// The build step imports this module to analyse the app, don't touch the real database then.
if (!building) mkdirSync(DATA_DIR, { recursive: true });
const client = createClient({ url: building ? ':memory:' : `file:${databasePath(DATA_DIR)}` });

export const db = drizzle(client, { schema });

/** Applies the migrations in `drizzle/` (generated with `pnpm db:generate`). */
export async function runMigrations() {
	await migrate(db, { migrationsFolder: 'drizzle' });
}
