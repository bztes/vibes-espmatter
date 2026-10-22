import { join } from 'node:path';

/** The SQLite file in the data directory. Standalone so drizzle.config.ts can import it. */
export function databasePath(dataDir: string) {
	return join(dataDir, 'app.db');
}
