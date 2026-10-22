import { defineConfig } from 'drizzle-kit';
import { databasePath } from './src/lib/server/db/path';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: { url: `file:${databasePath(process.env.DATA_DIR || './data')}` },
	verbose: true,
	strict: true
});
