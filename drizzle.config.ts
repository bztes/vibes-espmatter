import { mkdirSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

const dataDir = process.env.DATA_DIR ?? './data';
mkdirSync(dataDir, { recursive: true });

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: { url: `file:${dataDir}/app.db` },
	verbose: true,
	strict: true
});
