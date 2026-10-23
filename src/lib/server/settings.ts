import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { setting } from '#lib/server/db/schema.ts';

/** Every setting with its default, used until an admin changes it. */
const defaults = {
	/** Anyone can create an account (always possible while there is no admin). */
	signUpEnabled: false
};

export type Settings = typeof defaults;

export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
	const [row] = await db.select({ value: setting.value }).from(setting).where(eq(setting.key, key));
	return row ? (row.value as Settings[K]) : defaults[key];
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
	await db
		.insert(setting)
		.values({ key, value })
		.onConflictDoUpdate({ target: setting.key, set: { value } });
}
