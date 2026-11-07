/**
 * What is stored: a firmware's configuration (compiled once, shared by its devices) and the
 * settings of each device (identity and per-device values, written to its configuration
 * partition – no rebuild needed). Stored as JSON in the database; `normalize()` and
 * `normalizeDevice()` make any input (old versions, untrusted requests) safe to work with.
 */
import type { DeviceKind, Settings } from '#sdk';

export interface PeripheralInstance {
	/** Stable id of the instance (`[a-z0-9]{6}`), part of REST paths and C identifiers. */
	uid: string;
	peripheral: string;
	name: string;
	settings: Settings;
}

/** Part of the firmware (sdkconfig): the same for all its devices. */
export interface MatterProduct {
	vendorId: number;
	productId: number;
}

/** The firmware: boards, features and peripherals. Per-device fields hold the defaults of its devices. */
export interface FirmwareConfig {
	schema: 2;
	kind: DeviceKind;
	name: string;
	/** Board per slot: `main`, plus slots of enabled features (e.g. `radio`). */
	boards: Record<string, string>;
	/** Enabled features with their settings. */
	features: Record<string, Settings>;
	peripherals: PeripheralInstance[];
	matter: MatterProduct;
}

export interface UpdatePolicy {
	/** The device asks for updates by itself (Wi-Fi: from the app, Thread: through its hub). */
	pull: boolean;
	/** Minutes between checks (the app can also ask for one right away). */
	intervalMin: number;
}

/** Everything of one device besides the firmware it runs: stored in its configuration partition. */
export interface DeviceSettings {
	schema: 1;
	/** Unique per device. */
	matter: { discriminator: number; passcode: number };
	updates: UpdatePolicy;
	/** Hostname on the network (Wi-Fi, Ethernet, mDNS); empty: from the device name. */
	hostname: string;
	/** Where the device reaches this app (pulls, reports); empty: the server's public URL. */
	appUrl: string;
	/**
	 * Admin password of the device web interface as `pbkdf2-sha256$<iterations>$<salt>$<hash>`
	 * (hex); empty: none set. Never the password itself.
	 */
	uiPasswordHash: string;
	/**
	 * Values of per-device plugin fields set for this device, by scope (`feature:<id>`,
	 * `peripheral:<uid>`). Missing ones come from the firmware.
	 */
	plugins: Record<string, Settings>;
}

export const MAIN = 'main';

/** Espressif's test vendor id and a product id: fine for self-built devices. */
export const TEST_VENDOR_ID = 0xfff1;
