/**
 * What every device gets, whatever plugins are enabled: the REST API core (system, identify,
 * reboot), the Matter node with its onboarding data, and firmware updates: pulled from the app –
 * or, for Thread devices, through a hub's update relay. The app can ask for a check right away.
 */
import type { ApiRoute, Contributor } from '#sdk';
import type { BuildInfo } from './assemble';
import { platformCfg } from './cfg';
import type { Resolved } from './engine';
import { KINDS } from './kinds';
import { MAIN } from './model';

export const PLATFORM_DIR = 'src/lib/core/platform';

export type UpdateRoute = 'direct' | 'hub' | 'none';

/**
 * How the main board can get updates on its own. Whether a device does is its own setting
 * (`updates.pull`), read at runtime.
 */
export function updateRoute(r: Resolved): UpdateRoute {
	if (r.has('uplink')) return 'direct';
	if (r.has('thread')) return 'hub';
	return 'none';
}

/** Hubs keep accounts of their own (admins, and users with grants per paired device and endpoint). */
export const hasAccounts = (r: Resolved) => r.config.kind === 'hub';

export const CORE_API: ApiRoute[] = [
	{
		method: 'GET',
		path: '/api/v1/info',
		summary: 'Device identity and firmware',
		description: 'Public, so tools and the app can find out what is at an address.',
		auth: 'public',
		response: {
			id: '6f1c…',
			name: 'Living room',
			kind: 'device',
			firmware: { version: 12, build: 'a3f9…', idf: 'v5.4.2' },
			chip: 'esp32c6',
			peripherals: [{ uid: 'k3f9a1', peripheral: 'relay', name: 'Lamp', endpoint: 1 }]
		}
	},
	{
		method: 'GET',
		path: '/api/v1/system',
		summary: 'Health: uptime, memory, network',
		auth: 'token',
		response: {
			uptime: 86400,
			resetReason: 'power-on',
			heap: { free: 81234, min: 60211 },
			psram: { free: 2012345 },
			network: { ip: '192.168.1.42', ip6: ['fe80::…'], rssi: -58 }
		}
	},
	{
		method: 'POST',
		path: '/api/v1/system/reboot',
		summary: 'Restart the device',
		auth: 'token',
		response: { ok: true }
	}
];

/** Routes of a Matter device (not of a hub, which is only a controller). */
export const MATTER_DEVICE_API: ApiRoute[] = [
	{
		method: 'POST',
		path: '/api/v1/system/identify',
		summary: 'Blink / beep so you find the device',
		auth: 'token',
		params: [{ name: 'seconds', type: 'number', description: 'Duration, default 10', in: 'body' }],
		response: { ok: true }
	},
	{
		method: 'GET',
		path: '/api/v1/matter',
		summary: 'Commissioning state and pairing codes',
		auth: 'token',
		response: {
			commissioned: true,
			fabrics: 2,
			windowOpen: false,
			qr: 'MT:Y.K9042C00KA0648G00',
			manualCode: '3497-011-2332'
		}
	},
	{
		method: 'POST',
		path: '/api/v1/matter/window',
		summary: 'Open the commissioning window (pair with another controller)',
		auth: 'token',
		params: [{ name: 'seconds', type: 'number', description: 'Default 300', in: 'body' }],
		response: { ok: true }
	},
	{
		method: 'POST',
		path: '/api/v1/matter/factory-reset',
		summary: 'Leave all fabrics and erase Matter data',
		auth: 'token',
		response: { ok: true }
	}
];

const ACCOUNT_EXAMPLE = {
	id: 3,
	name: 'anna',
	admin: false,
	mustChange: false,
	grants: { n17: 2, n18: 1, 'n18.2': 0 }
};

/**
 * Account management of hubs (admins only). Grants: `{"<resource>": 0 none | 1 read | 2 write}`,
 * resources `n<node>` (a paired device), `n<node>.<endpoint>` (overrides the device's grant) and `s<scene>`.
 */
export const ACCOUNTS_API: ApiRoute[] = [
	{
		method: 'GET',
		path: '/api/v1/auth/accounts',
		summary: 'Accounts of the web interface',
		description:
			'The built-in `admin` (password from the app, id 0) and the accounts created on the hub. Grants: `{"<resource>": 0 none | 1 read | 2 write}` with resources `n<node>` (a paired device) and `n<node>.<endpoint>` (overrides the device’s grant), and `s<scene>` (read: run it, write: also change it).',
		auth: 'token',
		response: {
			accounts: [{ id: 0, name: 'admin', admin: true, builtin: true }, ACCOUNT_EXAMPLE]
		}
	},
	{
		method: 'POST',
		path: '/api/v1/auth/accounts',
		summary: 'Create an account',
		description:
			'The hub generates the password and returns it once (`password`). The account must change it at the first login (`mustChange`); until then its session may only call `/api/v1/auth/password`, `/me` and `/logout`.',
		auth: 'token',
		params: [
			{
				name: 'name',
				type: 'string',
				description: 'Lowercase letters, digits, `.` `_` `-`; up to 23',
				required: true,
				in: 'body'
			},
			{ name: 'admin', type: 'boolean', description: 'Admin (all rights)', in: 'body' },
			{ name: 'grants', type: 'object', description: 'Read/write grants of a user', in: 'body' }
		],
		response: { ...ACCOUNT_EXAMPLE, mustChange: true, password: 'h7KmQ2xR9pLw4z' }
	},
	{
		method: 'PUT',
		path: '/api/v1/auth/accounts/*',
		summary: 'Change an account (`/api/v1/auth/accounts/<id>`)',
		description:
			'Fields left out stay. `resetPassword` generates a new password (returned once as `password`, to be changed at the next login) and ends the account’s sessions.',
		auth: 'token',
		params: [
			{
				name: 'resetPassword',
				type: 'boolean',
				description: 'Generate a new password',
				in: 'body'
			},
			{ name: 'admin', type: 'boolean', description: 'Admin (all rights)', in: 'body' },
			{ name: 'grants', type: 'object', description: 'Replaces all grants', in: 'body' }
		],
		response: ACCOUNT_EXAMPLE
	},
	{
		method: 'POST',
		path: '/api/v1/auth/password',
		summary: 'Change your own password',
		description:
			'Any account but the built-in `admin` (its password is set in the app). Ends all sessions of the account and returns a new session token.',
		auth: 'token',
		params: [
			{
				name: 'current',
				type: 'string',
				description: 'The current password',
				required: true,
				in: 'body'
			},
			{
				name: 'password',
				type: 'string',
				description: 'The new password, 8–64 characters',
				required: true,
				in: 'body'
			}
		],
		response: { token: '9f2c41d0…' }
	},
	{
		method: 'DELETE',
		path: '/api/v1/auth/accounts/*',
		summary: 'Delete an account (`/api/v1/auth/accounts/<id>`)',
		auth: 'token',
		response: { ok: true }
	}
];

const OTA_STATUS: ApiRoute = {
	method: 'GET',
	path: '/api/v1/ota',
	summary: 'Running firmware and update state',
	auth: 'token',
	response: {
		version: 12,
		config: '3fa9c01b2d44',
		pull: true,
		partition: 'ota_0',
		state: 'idle',
		lastCheck: 1730700000,
		lastCheckAgo: 420,
		lastError: ''
	}
};

const METRICS: ApiRoute = {
	method: 'GET',
	path: '/api/v1/metrics',
	summary: 'Current measurements of all peripherals',
	description:
		'Every value a peripheral publishes (`espm_metric_set`), e.g. for Prometheus-style scraping or OpenTelemetry.',
	auth: 'token',
	response: {
		metrics: [{ name: 'temperature', labels: 'sensor=k3f9a1', unit: 'Cel', value: 21.4 }]
	}
};

const UPDATE_CHECK: ApiRoute = {
	method: 'POST',
	path: '/api/v1/ota/check',
	summary: 'Check for an update now',
	description:
		'The device asks the app (or its hub’s relay) for new firmware and settings right away instead of at its next periodic check. Called by the app after releasing a build or saving settings. 409 when the device doesn’t take updates from the app.',
	auth: 'token',
	response: { ok: true }
};

export function platform(r: Resolved, out: Contributor, build?: BuildInfo) {
	const config = r.config;
	const route = updateRoute(r);
	const http = r.has('ip');
	const matterDevice = KINDS[config.kind].matterDevice;

	for (const slot of r.slots) {
		const fw = out.firmware(slot.id);
		fw.define({
			ESPM_DEVICE_KIND: config.kind,
			ESPM_SLOT: slot.id,
			ESPM_FW_VERSION: build?.version ?? 1,
			ESPM_BUILD_ID: build?.buildId ?? 'local'
		});
		if (slot.framework !== 'esp-matter') continue;

		// Everything of the device comes from its configuration partition (espm_cfg.cpp).
		fw.source(
			'espm.h',
			'espm_cfg.h',
			'espm_cfg.cpp',
			'espm_matter.cpp',
			'espm_ota.cpp',
			'espm_time.cpp'
		)
			.include('"espm.h"')
			.partition('espm_cfg', 'data', 'nvs', 16)
			.define({
				ESPM_DEVICE_ID: platformCfg('id', ''),
				ESPM_DEVICE_NAME: platformCfg('name', config.name),
				ESPM_API_TOKEN: platformCfg('token', ''),
				ESPM_APP_URL: platformCfg('app_url', ''),
				ESPM_UI_PW_HASH: platformCfg('ui_hash', ''),
				ESPM_MATTER_VENDOR_ID: config.matter.vendorId,
				ESPM_MATTER_PRODUCT_ID: config.matter.productId,
				// Without a configuration: the CHIP test device's codes.
				ESPM_MATTER_DISCRIMINATOR: platformCfg('disc', 3840),
				ESPM_MATTER_PASSCODE: platformCfg('passcode', 20202021),
				ESPM_MATTER_QR: platformCfg('qr', ''),
				ESPM_MATTER_MANUAL_CODE: platformCfg('manual', ''),
				ESPM_CFG_REV: platformCfg('rev', ''),
				ESPM_MATTER_SERVER: matterDevice,
				ESPM_HTTP: http,
				// Accounts with roles and per-device grants, managed on the hub itself (espm_users.cpp).
				ESPM_USERS: http && hasAccounts(r),
				// Compiled in when the network allows it; each device switches them on or off.
				ESPM_UPDATE_PULL: route !== 'none',
				ESPM_UPDATE_VIA_HUB: route === 'hub',
				ESPM_UPDATE_PULL_ON: platformCfg('pull', true),
				ESPM_UPDATE_INTERVAL_MIN: platformCfg('interval', 60),
				// Boards this one flashes over a wire (wiredSlots).
				ESPM_SLOTFLASH: false
			})
			.sdkconfig(
				matterDevice
					? {
							CONFIG_ESP_MATTER_ENABLE_DATA_MODEL: true,
							CONFIG_CUSTOM_COMMISSIONABLE_DATA_PROVIDER: true
						}
					: // Only a controller: no Matter server, no data model (needed for the commissioner).
						{ CONFIG_ESP_MATTER_ENABLE_MATTER_SERVER: false }
			)
			.sdkconfig({
				CONFIG_BT_ENABLED: true,
				CONFIG_BT_NIMBLE_ENABLED: true,
				CONFIG_ENABLE_CHIPOBLE: true,
				CONFIG_USE_MINIMAL_MDNS: true,
				CONFIG_ESP_HTTPS_OTA_ALLOW_HTTP: true,
				// The app may be reached over HTTPS (each device has its own app URL).
				CONFIG_MBEDTLS_CERTIFICATE_BUNDLE: true
			})
			.init('early', 'espm_cfg_init();')
			.init('matter', 'espm_matter_init();')
			.init('started', 'espm_ota_init();')
			.init('started', 'espm_metrics_init();');
		fw.source('espm_metrics.cpp');
		if (route === 'hub') fw.sdkconfig({ CONFIG_OPENTHREAD_DNS_CLIENT: true });
		if (http) {
			fw.source('espm_http.cpp', 'espm_system.cpp', 'espm_users.cpp')
				.sdkconfig({
					CONFIG_HTTPD_MAX_URI_LEN: 512,
					CONFIG_HTTPD_MAX_REQ_HDR_LEN: 1024,
					// The default 10 sockets are all taken by the HTTP server (up to 7 sessions + 2)
					// plus the tunnel, its loopback requests and the exporters: "accept (23)".
					CONFIG_LWIP_MAX_SOCKETS: 16
				})
				.init('early', 'espm_http_init();')
				.init('late', 'espm_http_start();');
		}
		// Two app partitions for updates.
		fw.define({ ESPM_OTA_SLOTS: true });
	}
	wiredSlots(r, out, http);

	if (r.has('ip')) out.api(...CORE_API, ...(matterDevice ? MATTER_DEVICE_API : []));
	if (http) out.api(OTA_STATUS);
	if (route !== 'none' && http) out.api(UPDATE_CHECK);
	if (http) out.api(METRICS);

	// System and update widgets, on the settings page (when a feature provides one).
	out.ui(
		{
			page: 'settings',
			file: 'SystemWidget.svelte',
			title: 'System',
			tab: 'System',
			order: 90,
			props: { identify: matterDevice }
		},
		{
			page: 'settings',
			file: 'UpdatesWidget.svelte',
			title: 'Firmware',
			tab: 'System',
			order: 91,
			props: { canPull: route !== 'none' }
		}
	);
	if (matterDevice)
		out.ui({
			page: 'settings',
			file: 'MatterWidget.svelte',
			title: 'Matter pairing',
			tab: 'Matter',
			order: 5
		});

	if (route === 'hub')
		out.note(
			'Updates reach this Thread device through a hub with the "Update relay" feature: the device finds it on the Thread network and pulls through it.'
		);
	const first = r.slots.filter((s) => s.id !== MAIN && s.flashFirst);
	if (first.length)
		out.note(`Flash ${first.map((s) => s.name).join(', ')} first, then the main board.`);
	const wired = r.slots.filter((s) => s.wired);
	if (wired.length)
		out.note(
			`${wired.map((s) => s.name).join(', ')}: flash over USB once – after that the main board installs ${wired.length > 1 ? 'their' : 'its'} updates over the wires: release them like the main board's, the main board fetches and flashes them.`
		);
}

const SLOTS_STATUS: ApiRoute = {
	method: 'GET',
	path: '/api/v1/slots',
	summary: 'Boards the main board flashes over a wire',
	description:
		'Per board: the version the main board installed on it (0: unknown, e.g. flashed over USB) and how the last update went (`idle`, `flashing`, `failed`: see `error`).',
	auth: 'token',
	response: {
		slots: [
			{
				id: 'radio',
				name: 'Thread radio (RCP)',
				chip: 'esp32h2',
				version: 12,
				state: 'idle',
				progress: 0,
				error: ''
			}
		]
	}
};

/**
 * Slots the main board flashes (`SlotDef.flashOverWire`). Their updates are deployments like the
 * main board's: the main board asks the app (or a hub's relay) and streams the image into the
 * slot. The slot is flashed in its ROM download mode, entered when the main board pulls
 * the trigger line low. Plugins wait (`espm_slot_wait`) before using the wires.
 */
function wiredSlots(r: Resolved, out: Contributor, http: boolean) {
	// The main board gets their updates the way it gets its own: without a route, USB only.
	const wired = r.slots.filter((s) => s.wired && s.chip.rom);
	if (!wired.length || updateRoute(r) === 'none') return;
	out
		.firmware(MAIN)
		.source('espm_slotflash.h', 'espm_slotflash.cpp')
		.include('"espm_slotflash.h"')
		.define({ ESPM_SLOTFLASH: true })
		.init('started', 'espm_slotflash_start();');
	for (const slot of wired) {
		const pins = slot.wired!;
		out
			.firmware(slot.id)
			.source('espm_slotboot.h', 'espm_slotboot.c')
			.include('"espm_slotboot.h"')
			.define({ ESPM_SLOTBOOT_TRIGGER: pins.slotTrigger })
			.init('early', 'espm_slotboot_start();');
		out.wire({
			from: { node: 'slot:main', pin: `gpio:${pins.hostTrigger}` },
			to: { node: `slot:${slot.id}`, pin: `gpio:${pins.slotTrigger}` },
			label: 'Update trigger (main board flashes the board)',
			color: '#a855f7'
		});
	}
	if (http) out.api(SLOTS_STATUS);
}
