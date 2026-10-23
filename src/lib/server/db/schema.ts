import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ProjectConfig } from '#lib/device/types.ts';
import { user } from './auth.schema';
import type { BuildStatus, RoleBuildState } from '#lib/build-types.ts';

export type { BuildStatus, FlashPart, RoleArtifacts, RoleBuildState } from '#lib/build-types.ts';

const timestamps = {
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.$onUpdate(() => new Date())
		.notNull()
};

/** A saved device configuration, owned by a user (see `server/owner.ts`). */
export const project = sqliteTable(
	'project',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** Template the device was created from, or `custom`. */
		deviceType: text('device_type').notNull(),
		config: text('config', { mode: 'json' }).$type<ProjectConfig>().notNull(),
		/** Web interface of the device as last reported over serial (`http://192.168.1.50`). */
		lastAddress: text('last_address'),
		lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
		...timestamps
	},
	(t) => [index('project_user_idx').on(t.userId)]
);

/** A firmware build of a configuration (saved project or anonymous). */
export const build = sqliteTable(
	'build',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		configHash: text('config_hash').notNull(),
		config: text('config', { mode: 'json' }).$type<ProjectConfig>().notNull(),
		status: text('status').$type<BuildStatus>().notNull().default('queued'),
		roles: text('roles', { mode: 'json' }).$type<Record<string, RoleBuildState>>().notNull(),
		error: text('error'),
		startedAt: integer('started_at', { mode: 'timestamp_ms' }),
		finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
		...timestamps
	},
	(t) => [index('build_project_idx').on(t.projectId), index('build_hash_idx').on(t.configHash)]
);

/** How a worker is reached, and what that needs (`worker.config`). */
export interface WorkerConfigs {
	/** idf-worker.py at `url`, e.g. the `idf` compose service; it shares DATA_DIR with this server. */
	'idf-docker': { url: string; maxWorkspaces: number };
	/** ESP-IDF at `idfPath` on this server. */
	'idf-local': {
		idfPath: string;
		/** Python the ESP-IDF was installed with, if not `python3` on PATH. */
		idfPython?: string;
		maxWorkspaces: number;
	};
}
export type WorkerKind = keyof WorkerConfigs;

/**
 * A machine that runs jobs (e.g. firmware builds) for this server, set up by an admin (/admin).
 * Everything that depends on the `kind` lives in `config`, so new kinds need no migration.
 */
export const worker = sqliteTable('worker', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	kind: text('kind').$type<WorkerKind>().notNull(),
	config: text('config', { mode: 'json' }).$type<WorkerConfigs[WorkerKind]>().notNull(),
	...timestamps
});

/** A `worker` row with `config` narrowed by `kind`. */
export type Worker = Omit<typeof worker.$inferSelect, 'kind' | 'config'> &
	{ [K in WorkerKind]: { kind: K; config: WorkerConfigs[K] } }[WorkerKind];

/** Server-wide settings an admin can change, one row per key (see `server/settings.ts`). */
export const setting = sqliteTable('setting', {
	key: text('key').primaryKey(),
	value: text('value', { mode: 'json' }).notNull(),
	...timestamps
});

export * from './auth.schema';
