/**
 * Firmware updates the owner starts in the app: they mark a build for a chip of their device
 * (`device_update`). Boards with `app_updates` fetch their own from here, hubs with `matter_updates` those of
 * their Thread and Wi-Fi Matter devices (`matter_ota`, known by their UniqueID, `updateId`) and
 * stream them through. Both ask now and then and report how far they got. Their token is their
 * project id, signed: a board gets its own updates, a hub also those of its owner's devices.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { BETTER_AUTH_SECRET } from '$app/env/private';
import { normalizeProject } from '#lib/device/generator.ts';
import { updateId, versionString } from '#lib/device/util.ts';
import { db } from '#lib/server/db/index.ts';
import { build, deviceUpdate, project, type DeviceUpdateState } from '#lib/server/db/schema.ts';
import { artifactDir } from '#lib/server/builder/index.ts';

/** A build's software version: its creation time in seconds, as compiled in (`BuildInfo.version`). */
export const buildVersion = (createdAt: Date) => Math.floor(createdAt.getTime() / 1000);

const signature = (projectId: string) =>
	createHmac('sha256', BETTER_AUTH_SECRET)
		.update(`matter-updates:${projectId}`)
		.digest('base64url')
		.slice(0, 32);

/** The token of a device: its project id, signed. Built into its firmware. */
export const updateToken = (projectId: string) => `${projectId}.${signature(projectId)}`;

/** The saved device a token is of; undefined if it's not one of ours. */
async function tokenProject(token: string) {
	const [projectId, sig] = token.split('.');
	if (!projectId || !sig) return undefined;
	const expected = Buffer.from(signature(projectId));
	const given = Buffer.from(sig);
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
	const [row] = await db
		.select({ id: project.id, userId: project.userId })
		.from(project)
		.where(eq(project.id, projectId));
	return row;
}

/** The device a request's `Authorization: Bearer <token>` is of; 401 otherwise. */
export async function bearerProject(request: Request) {
	const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
	const row = token ? await tokenProject(token) : undefined;
	if (!row) error(401, 'Unknown token');
	return row;
}

/** Plain text answers: the boards need no JSON parser for them. */
export const plain = (body: string) =>
	new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });

/** The owner wants this build on its chip: replaces what was asked for it before. */
export async function requestUpdate(row: typeof build.$inferSelect, role: string) {
	if (!row.projectId || row.status !== 'success' || !row.roles[role]?.artifacts) return false;
	const values = {
		projectId: row.projectId,
		role,
		buildId: row.id,
		version: buildVersion(row.createdAt),
		state: 'requested' as const,
		message: null
	};
	await db
		.insert(deviceUpdate)
		.values(values)
		.onConflictDoUpdate({ target: [deviceUpdate.projectId, deviceUpdate.role], set: values });
	return true;
}

export async function getUpdate(projectId: string, role: string) {
	const [row] = await db
		.select()
		.from(deviceUpdate)
		.where(and(eq(deviceUpdate.projectId, projectId), eq(deviceUpdate.role, role)));
	return row;
}

/** Not done or failed yet. */
export const OPEN: DeviceUpdateState[] = ['requested', 'downloading', 'installing'];

/** A board asks for its own update. Running the version already: it's done. */
export async function selfUpdate(projectId: string, role: string, current: number) {
	const [found] = await db
		.select({ update: deviceUpdate, roles: build.roles })
		.from(deviceUpdate)
		.innerJoin(build, eq(build.id, deviceUpdate.buildId))
		.where(and(eq(deviceUpdate.projectId, projectId), eq(deviceUpdate.role, role)));
	const row = found?.update;
	if (!row || !OPEN.includes(row.state)) return undefined;
	if (current >= row.version) {
		await report(row, 'done', null);
		return undefined;
	}
	const app = found.roles[role]?.artifacts?.app;
	return app ? { ...row, file: `${row.buildId}/${role}/${app}` } : undefined;
}

/** The open updates of the owner's Matter devices, for their hub. */
export async function matterUpdates(userId: string) {
	const rows = await db
		.select({ update: deviceUpdate, config: project.config })
		.from(deviceUpdate)
		.innerJoin(project, eq(project.id, deviceUpdate.projectId))
		.where(and(eq(project.userId, userId), inArray(deviceUpdate.state, OPEN)));
	return rows
		.filter(({ update, config }) => {
			const chip = normalizeProject(config).chips.find((c) => c.id === update.role);
			return chip && 'matter_ota' in chip.features;
		})
		.map(({ update }) => ({ ...update, uniqueId: updateId(update.projectId, update.role) }));
}

/** How far an update got, as the board or hub reports it. */
export async function report(
	row: { projectId: string; role: string },
	state: DeviceUpdateState,
	message: string | null
) {
	await db
		.update(deviceUpdate)
		.set({ state, message })
		.where(and(eq(deviceUpdate.projectId, row.projectId), eq(deviceUpdate.role, row.role)));
}

// ---------------------------------------------------------------------------------------------
// Matter OTA image: header (TLV) + the app image (Matter spec, "OTA Software Update File Format")
// ---------------------------------------------------------------------------------------------

const FILE_IDENTIFIER = 0x1beef11e;
const DIGEST_SHA256 = 1;

/** A context-tagged TLV element: unsigned ints with a fixed width, strings with a 1-byte length. */
function tlv(tag: number, value: number | bigint | string | Buffer, width?: 1 | 2 | 4 | 8): Buffer {
	if (typeof value === 'string' || Buffer.isBuffer(value)) {
		const data = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
		return Buffer.concat([
			Buffer.from([typeof value === 'string' ? 0x2c : 0x30, tag, data.length]),
			data
		]);
	}
	const size = width ?? 8;
	const types = { 1: 0x24, 2: 0x25, 4: 0x26, 8: 0x27 } as const;
	const le = Buffer.alloc(8);
	le.writeBigUInt64LE(BigInt(value));
	return Buffer.concat([Buffer.from([types[size], tag]), le.subarray(0, size)]);
}

/** The OTA image header for `payload`. */
export function otaHeader(opts: {
	vendorId: number;
	productId: number;
	version: number;
	versionString: string;
	payload: Buffer;
}): Buffer {
	const digest = createHash('sha256').update(opts.payload).digest();
	const header = Buffer.concat([
		Buffer.from([0x15]),
		tlv(0, opts.vendorId, 2),
		tlv(1, opts.productId, 2),
		tlv(2, opts.version, 4),
		tlv(3, opts.versionString),
		tlv(4, opts.payload.length, 8),
		tlv(8, DIGEST_SHA256, 1),
		tlv(9, digest),
		Buffer.from([0x18])
	]);
	const prefix = Buffer.alloc(16);
	prefix.writeUInt32LE(FILE_IDENTIFIER, 0);
	prefix.writeBigUInt64LE(BigInt(16 + header.length + opts.payload.length), 4);
	prefix.writeUInt32LE(header.length, 12);
	return Buffer.concat([prefix, header]);
}

/** The OTA image of a build's chip (made once, next to its other files). */
export async function otaImage(
	row: typeof build.$inferSelect,
	role: string,
	vendorId: number,
	productId: number
): Promise<string | undefined> {
	const app = row.roles[role]?.artifacts?.app;
	if (!app) return undefined;
	const dir = artifactDir(row.id, role);
	const file = path.join(dir, `matter-${vendorId}-${productId}.ota`);
	if (existsSync(file)) return file;
	const payload = await fs.readFile(path.join(dir, app)).catch(() => undefined);
	if (!payload) return undefined;
	const version = buildVersion(row.createdAt);
	const header = otaHeader({
		vendorId,
		productId,
		version,
		versionString: versionString(version),
		payload
	});
	const tmp = `${file}.${process.pid}.tmp`;
	await fs.writeFile(tmp, Buffer.concat([header, payload]));
	await fs.rename(tmp, file);
	return file;
}
