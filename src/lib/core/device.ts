/**
 * Devices of a firmware: their settings (`normalizeDevice`), the configuration a device sees
 * (`effectiveConfig`: the firmware's settings plus the device's own), and what is written to its
 * configuration partition (`deviceEntries` → `nvsImage`).
 * Isomorphic: the configurator shows the same values the server writes.
 */
import type { PerDeviceField, Settings, SettingValue } from '#sdk';
import { cfgType, nvsNamespace, PLATFORM_KEYS, PLATFORM_NS, type CfgType } from './cfg';
import { coerceSetting, defaultsOf, fieldDefault, int, isPerDevice, resolve } from './engine';
import { KINDS } from './kinds';
import {
	manualPairingCode,
	qrPayload,
	randomDiscriminator,
	randomPasscode,
	validPasscode
} from './matter';
import type { DeviceSettings, FirmwareConfig } from './model';
import { features, peripherals } from './registry';

/** The plugin scopes of a firmware with their per-device fields. */
export function perDeviceScopes(config: FirmwareConfig) {
	const out: { scope: string; name: string; fields: PerDeviceField[] }[] = [];
	for (const id of Object.keys(config.features)) {
		const def = features.find(id);
		const fields = (def?.fields ?? []).filter(isPerDevice);
		if (def && fields.length) out.push({ scope: `feature:${id}`, name: def.name, fields });
	}
	for (const s of config.peripherals) {
		const fields = (peripherals.find(s.peripheral)?.fields ?? []).filter(isPerDevice);
		if (fields.length) out.push({ scope: `peripheral:${s.uid}`, name: s.name, fields });
	}
	return out;
}

/** A hostname: letters, digits and dashes, not at the start or end. */
export const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

/** A stored device admin password (`DeviceSettings.uiPasswordHash`). */
export const PASSWORD_HASH = /^pbkdf2-sha256\$\d{1,6}\$[0-9a-f]{32}\$[0-9a-f]{64}$/;
/** What the page gets instead of the hash: only whether there is one. */
export const PASSWORD_SET = 'set';

/**
 * Fill in defaults, coerce types, drop unknown keys. Safe on untrusted input. Every per-device
 * field of the firmware gets a value.
 */
export function normalizeDevice(raw: unknown, firmware: FirmwareConfig): DeviceSettings {
	const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<DeviceSettings>;
	const m = (input.matter ?? {}) as Partial<DeviceSettings['matter']>;
	const u = (input.updates ?? {}) as Partial<DeviceSettings['updates']>;
	const pwHash = String(input.uiPasswordHash ?? '');
	const passcode = int(m.passcode, 0, 1, 99999998);
	const appUrl = String(input.appUrl ?? '').trim();
	const hostname = String(input.hostname ?? '')
		.trim()
		.toLowerCase();

	const rawPlugins = (
		input.plugins && typeof input.plugins === 'object' ? input.plugins : {}
	) as Record<string, Record<string, unknown> | undefined>;
	const ctx = defaultsOf(firmware);
	const plugins: Record<string, Settings> = {};
	for (const { scope, fields } of perDeviceScopes(firmware)) {
		const values = rawPlugins[scope] ?? {};
		plugins[scope] = Object.fromEntries(
			fields.map((f) => [f.key, coerceSetting(f, values[f.key], fieldDefault(f, ctx))])
		);
	}

	return {
		schema: 1,
		matter: {
			discriminator: int(m.discriminator, randomDiscriminator(), 0, 0xfff),
			passcode: validPasscode(passcode) ? passcode : randomPasscode()
		},
		updates: {
			pull: u.pull === undefined ? true : !!u.pull,
			intervalMin: int(u.intervalMin, 60, 5, 24 * 60)
		},
		hostname: HOSTNAME.test(hostname) ? hostname : '',
		appUrl: /^https?:\/\/[^\s]+$/.test(appUrl) ? appUrl.replace(/\/$/, '').slice(0, 120) : '',
		uiPasswordHash: PASSWORD_HASH.test(pwHash) ? pwHash : '',
		plugins
	};
}

/** The firmware as one device sees it: its name, and its values of the per-device fields. */
export function effectiveConfig(
	firmware: FirmwareConfig,
	device: DeviceSettings,
	name: string
): FirmwareConfig {
	const config = structuredClone(firmware);
	config.name = name;
	for (const [id, settings] of Object.entries(config.features))
		Object.assign(settings, device.plugins[`feature:${id}`]);
	for (const s of config.peripherals)
		Object.assign(s.settings, device.plugins[`peripheral:${s.uid}`]);
	return config;
}

export interface CfgEntry {
	ns: string;
	key: string;
	type: CfgType;
	value: SettingValue;
}

/** What only the server knows about a device. */
export interface DeviceIdentity {
	id: string;
	name: string;
	apiToken: string;
	/** The server's public URL, used when the device has no app URL of its own. */
	appUrl: string;
}

/**
 * Everything in a device's configuration partition, sorted, plus `rev`: a hash of the rest.
 * The device reports `rev` back, so the app knows whether it has the current settings.
 */
export async function deviceEntries(
	firmware: FirmwareConfig,
	device: DeviceSettings,
	identity: DeviceIdentity
): Promise<{ entries: CfgEntry[]; rev: string }> {
	const m = device.matter;
	const platform: Record<Exclude<keyof typeof PLATFORM_KEYS, 'rev'>, SettingValue> = {
		id: identity.id,
		name: identity.name,
		host: device.hostname,
		token: identity.apiToken,
		app_url: device.appUrl || identity.appUrl,
		ui_hash: device.uiPasswordHash,
		pull: device.updates.pull,
		interval: device.updates.intervalMin,
		disc: m.discriminator,
		passcode: m.passcode,
		qr: KINDS[firmware.kind].matterDevice
			? qrPayload(firmware.matter.vendorId, firmware.matter.productId, m.discriminator, m.passcode)
			: '',
		manual: KINDS[firmware.kind].matterDevice
			? manualPairingCode(m.discriminator, m.passcode).replaceAll('-', '')
			: ''
	};
	const entries: CfgEntry[] = Object.entries(platform).map(([key, value]) => ({
		ns: PLATFORM_NS,
		key,
		type: PLATFORM_KEYS[key as keyof typeof PLATFORM_KEYS],
		value
	}));
	// Only plugins the firmware runs (resolve drops what doesn't fit the kind).
	const r = resolve(firmware);
	const active = new Set([
		...r.features.map((f) => `feature:${f.def.id}`),
		...r.peripherals.map((s) => `peripheral:${s.instance.uid}`)
	]);
	for (const { scope, fields } of perDeviceScopes(firmware)) {
		if (!active.has(scope)) continue;
		for (const f of fields)
			entries.push({
				ns: nvsNamespace(scope),
				key: f.key,
				type: cfgType(f),
				value: device.plugins[scope][f.key]
			});
	}
	const text = JSON.stringify(entries.map((e) => [e.ns, e.key, e.type, e.value]));
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	const rev = [...new Uint8Array(digest).slice(0, 6)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	entries.push({ ns: PLATFORM_NS, key: 'rev', type: 'str', value: rev });
	return { entries, rev };
}
