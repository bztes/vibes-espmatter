import { sql } from 'drizzle-orm';
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
	type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core';
import type { DeviceSettings, FirmwareConfig } from '#lib/core/model.ts';
import type { BuildStatus, DeployMethod, DeployState, SlotArtifacts } from '#lib/types.ts';

export type * from '#lib/types.ts';

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
const createdAt = integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now);
const updatedAt = () =>
	integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(now)
		.$onUpdate(() => new Date());
const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

export type Role = 'admin' | 'user';

export const user = sqliteTable('user', {
	id: id(),
	email: text('email').notNull().unique(),
	name: text('name').notNull(),
	passwordHash: text('password_hash').notNull(),
	role: text('role').$type<Role>().notNull().default('user'),
	disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
	/** Set with a generated password (added by an admin, reset): changed at the next sign-in. */
	mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
	lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
	createdAt
});

/** Login sessions; the id is the SHA-256 of the cookie value. */
export const session = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt
	},
	(t) => [index('session_user_idx').on(t.userId)]
);

/** Server-wide settings, one row per key (`server/settings.ts`). */
export const setting = sqliteTable('setting', {
	key: text('key').primaryKey(),
	value: text('value', { mode: 'json' }).notNull()
});

export type DeviceKind = 'hub' | 'device';

/** What a board last told the app (update reports), per slot. */
export interface SlotReport {
	running?: number;
	/** Revision of the device configuration it runs. */
	config?: string;
	state?: string;
	message?: string;
	at?: number;
}

/** A location with its own devices, e.g. "Home" or "Parents". */
export const location = sqliteTable(
	'location',
	{
		id: id(),
		ownerId: text('owner_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		createdAt
	},
	(t) => [index('location_owner_idx').on(t.ownerId)]
);

/** A firmware: boards, features and peripherals – built once, installed on any number of devices. */
export const firmware = sqliteTable(
	'firmware',
	{
		id: id(),
		ownerId: text('owner_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		kind: text('kind').$type<DeviceKind>().notNull(),
		config: text('config', { mode: 'json' }).$type<FirmwareConfig>().notNull(),
		/** Next build number (builds count up). */
		nextVersion: integer('next_version').notNull().default(1),
		createdAt,
		updatedAt: updatedAt()
	},
	(t) => [index('firmware_owner_idx').on(t.ownerId)]
);

/** A board running a firmware; what is its own (identity, per-device values) is in `settings`. */
export const device = sqliteTable(
	'device',
	{
		id: id(),
		ownerId: text('owner_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** The app refuses to delete a firmware with devices (cascade: deleting its owner works). */
		firmwareId: text('firmware_id')
			.notNull()
			.references(() => firmware.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** The firmware's kind, kept here for queries (hubs of a location). */
		kind: text('kind').$type<DeviceKind>().notNull(),
		/** Where it lives; null: no location. */
		locationId: text('location_id').references(() => location.id, { onDelete: 'set null' }),
		settings: text('settings', { mode: 'json' }).$type<DeviceSettings>().notNull(),
		/** Bearer token of the device: its REST API, update pulls and reports. */
		apiToken: text('api_token').notNull(),
		/** After rotating: the token the board still has, until it runs the new configuration. */
		previousToken: text('previous_token'),
		/** Hub that relays updates (Thread devices). */
		hubId: text('hub_id').references((): AnySQLiteColumn => device.id, { onDelete: 'set null' }),
		/**
		 * Its own hostname below the device domain (`matterhub` → matterhub.espmatter.app), where the
		 * app passes requests on to it through its tunnel (remote-access feature). Unique across all users.
		 */
		subdomain: text('subdomain'),
		lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
		reported: text('reported', { mode: 'json' })
			.$type<Record<string, SlotReport>>()
			.notNull()
			.default({}),
		createdAt,
		updatedAt: updatedAt()
	},
	(t) => [
		index('device_owner_idx').on(t.ownerId),
		index('device_firmware_idx').on(t.firmwareId),
		uniqueIndex('device_subdomain_idx').on(t.subdomain)
	]
);

export const build = sqliteTable(
	'build',
	{
		id: id(),
		firmwareId: text('firmware_id')
			.notNull()
			.references(() => firmware.id, { onDelete: 'cascade' }),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		version: integer('version').notNull(),
		status: text('status').$type<BuildStatus>().notNull().default('queued'),
		config: text('config', { mode: 'json' }).$type<FirmwareConfig>().notNull(),
		slots: text('slots', { mode: 'json' })
			.$type<Record<string, SlotArtifacts>>()
			.notNull()
			.default({}),
		/** Slot currently compiling. */
		step: text('step'),
		error: text('error'),
		runnerId: text('runner_id'),
		createdAt,
		startedAt: integer('started_at', { mode: 'timestamp_ms' }),
		finishedAt: integer('finished_at', { mode: 'timestamp_ms' })
	},
	(t) => [index('build_firmware_idx').on(t.firmwareId)]
);

/** Getting a build onto a slot of a device. */
export const deployment = sqliteTable(
	'deployment',
	{
		id: id(),
		deviceId: text('device_id')
			.notNull()
			.references(() => device.id, { onDelete: 'cascade' }),
		buildId: text('build_id')
			.notNull()
			.references(() => build.id, { onDelete: 'cascade' }),
		slot: text('slot').notNull(),
		version: integer('version').notNull(),
		method: text('method').$type<DeployMethod>().notNull(),
		state: text('state').$type<DeployState>().notNull().default('pending'),
		message: text('message'),
		createdAt,
		updatedAt: updatedAt()
	},
	(t) => [index('deployment_device_idx').on(t.deviceId, t.slot)]
);

/** Where firmware is compiled: a runner (runner/runner.py), added by an admin. */
export const runner = sqliteTable('runner', {
	id: id(),
	name: text('name').notNull(),
	/** SHA-256 of the runner's token, which is shown once. */
	tokenHash: text('token_hash').notNull().unique(),
	/** Reported by the runner; null until it first polls. */
	idfVersion: text('idf_version'),
	/** Parallel builds. */
	concurrency: integer('concurrency').notNull().default(1),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	lastSeen: integer('last_seen', { mode: 'timestamp_ms' }),
	createdAt
});
