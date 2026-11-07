/**
 * Names in the device configuration partition (`espm_cfg`, an NVS partition): the platform's
 * namespace and one per plugin scope, and the C expressions firmware uses to read values.
 */
import { CExpr, cString, type PerDeviceField, type SettingValue } from '#sdk';

/** NVS partition label (also in `espm_cfg.cpp`). */
export const CFG_PARTITION = 'espm_cfg';
export const CFG_PARTITION_SIZE = 0x4000;

/** Namespace of the platform's values (identity, updates, access). */
export const PLATFORM_NS = 'espm';

/** NVS names are at most 15 characters. */
export const NVS_NAME_MAX = 15;

function fnv(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
	return h.toString(36).slice(0, 4);
}

/** `feature:<id>` → `f.<id>`, `peripheral:<uid>` → `p.<uid>`; long ids get shortened with a hash. */
export function nvsNamespace(scope: string): string {
	const [type, id] = scope.split(':');
	const name = `${type === 'peripheral' ? 'p' : 'f'}.${id}`;
	return name.length <= NVS_NAME_MAX ? name : `${name.slice(0, NVS_NAME_MAX - 5)}~${fnv(name)}`;
}

/** How a field's value is stored and read. */
export type CfgType = 'str' | 'int' | 'num' | 'bool';

export function cfgType(field: PerDeviceField): CfgType {
	switch (field.type) {
		case 'boolean':
			return 'bool';
		case 'number':
			return field.integer ? 'int' : 'num';
		default:
			return 'str';
	}
}

function cLiteral(type: CfgType, value: SettingValue): string {
	switch (type) {
		case 'bool':
			return value ? 'true' : 'false';
		case 'int':
			return String(Math.round(Number(value) || 0));
		case 'num':
			return String(Number(value) || 0);
		default:
			return cString(String(value));
	}
}

/** `espm_cfg_<type>("<ns>", "<key>", <fallback>)` – see `espm_cfg.h`. */
export function cfgExpr(ns: string, key: string, type: CfgType, fallback: SettingValue): CExpr {
	return new CExpr(
		`espm_cfg_${type}(${cString(ns)}, ${cString(key)}, ${cLiteral(type, fallback)})`
	);
}

/** The platform's values: key → type. */
export const PLATFORM_KEYS = {
	id: 'str',
	name: 'str',
	/** Hostname; empty: from the name. */
	host: 'str',
	token: 'str',
	app_url: 'str',
	/** PBKDF2 hash of the admin password, never the password. */
	ui_hash: 'str',
	pull: 'bool',
	interval: 'int',
	disc: 'int',
	passcode: 'int',
	qr: 'str',
	manual: 'str',
	/** Revision of the whole configuration: reported back, so the app knows what a device has. */
	rev: 'str'
} as const satisfies Record<string, CfgType>;

export const platformCfg = (key: keyof typeof PLATFORM_KEYS, fallback: SettingValue) =>
	cfgExpr(PLATFORM_NS, key, PLATFORM_KEYS[key], fallback);
