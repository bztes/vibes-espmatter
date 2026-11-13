/**
 * Everything that is wrong (errors block builds) or worth knowing (warnings, infos) about a
 * configuration: settings, board capabilities, plugin requirements and pin conflicts.
 */
import {
	CHIPS,
	type BoardDef,
	type Field,
	type HardwareRequirements,
	type Issue,
	type Settings
} from '#sdk';
import {
	pinFields,
	pinLabel,
	pinProblem,
	pinWarning,
	pluginContext,
	resolve,
	type Resolved,
	type ResolvedSlot
} from './engine';
import { effectiveConfig, HOSTNAME, isPerDevice } from './device';
import { KINDS } from './kinds';
import { validPasscode } from './matter';
import { MAIN, type DeviceSettings, type FirmwareConfig } from './model';

/** Minimum flash for a Matter firmware, and with two OTA slots. */
const MATTER_MIN_FLASH_MB = 4;

export function requirementIssues(
	board: BoardDef,
	req: HardwareRequirements | undefined,
	what: string
): string[] {
	if (!req) return [];
	const chip = CHIPS[board.chip];
	const caps = new Set([...chip.capabilities, ...(board.psram !== 'none' ? ['psram'] : [])]);
	if (board.ethernet) caps.add('ethernet-mac');
	const out: string[] = [];
	const missing = (req.capabilities ?? []).filter((c) => !caps.has(c));
	if (missing.length)
		out.push(
			`${what}: the ${board.name} (${chip.name}) has no ${missing.map(capName).join(' and ').replace(/^an? /, '')}.`
		);
	if (req.anyCapability?.length && !req.anyCapability.some((c) => caps.has(c)))
		out.push(
			`${what}: needs ${req.anyCapability.map(capName).join(' or ')}, the ${board.name} (${chip.name}) has none.`
		);
	if (req.minFlashMB && board.flashMB < req.minFlashMB)
		out.push(
			`${what} needs at least ${req.minFlashMB} MB flash (the ${board.name} has ${board.flashMB} MB).`
		);
	if (req.psram && board.psram === 'none')
		out.push(`${what} needs PSRAM, the ${board.name} has none.`);
	return out;
}

export function capName(cap: string): string {
	return (
		{
			wifi: 'Wi-Fi',
			'wifi-5ghz': '5 GHz Wi-Fi',
			ble: 'Bluetooth LE',
			ieee802154: 'an 802.15.4 (Thread) radio',
			'ethernet-mac': 'Ethernet',
			'usb-otg': 'USB OTG',
			'usb-serial-jtag': 'native USB',
			psram: 'PSRAM'
		}[cap] ?? cap
	);
}

/**
 * `firmware`: per-device fields hold defaults, so they may stay empty. `device`: the values the
 * device gets.
 */
export type Level = 'firmware' | 'device';

function fieldIssues(
	fields: Field[] = [],
	settings: Settings,
	scope: string,
	level: Level = 'firmware'
): Issue[] {
	const issues: Issue[] = [];
	for (const f of fields) {
		if (f.when && !f.when(settings)) continue;
		const value = settings[f.key];
		const err = (message: string) =>
			issues.push({ severity: 'error', scope, field: f.key, message });
		switch (f.type) {
			case 'text': {
				const s = String(value ?? '');
				if (f.required && !s.trim()) {
					if (!f.perDevice || level === 'device') err(`${f.label} is required.`);
				} else if (f.maxLength && s.length > f.maxLength)
					err(`${f.label} must be at most ${f.maxLength} characters.`);
				else if (s && f.pattern && !f.pattern.regex.test(s)) err(f.pattern.message);
				break;
			}
			case 'number': {
				const n = Number(value);
				if (!Number.isFinite(n)) err(`${f.label} must be a number.`);
				else if (f.integer && !Number.isInteger(n)) err(`${f.label} must be a whole number.`);
				else if (f.min !== undefined && n < f.min) err(`${f.label} must be at least ${f.min}.`);
				else if (f.max !== undefined && n > f.max) err(`${f.label} must be at most ${f.max}.`);
				break;
			}
			case 'select':
				if (!f.options.some((o) => o.value === value)) err(`${f.label}: pick an option.`);
				break;
			case 'gpio':
				if (Number(value) < 0 && !f.optional) err(`${f.label}: pick a pin.`);
				break;
		}
	}
	return issues;
}

export function validate(
	config: FirmwareConfig,
	r: Resolved = resolve(config),
	level: Level = 'firmware'
): Issue[] {
	const issues: Issue[] = [];
	const kind = KINDS[config.kind];
	const main = r.slot(MAIN);
	const push = (severity: Issue['severity'], scope: string, message: string, field?: string) =>
		issues.push({ severity, scope, message, field });

	// Boards ----------------------------------------------------------------------------------
	for (const slot of r.slots) {
		const scope = `board:${slot.id}`;
		if (slot.framework === 'esp-matter') {
			if (slot.chip.matterUnsupported) push('error', scope, slot.chip.matterUnsupported);
			if (slot.board.flashMB < MATTER_MIN_FLASH_MB)
				push('error', scope, `Matter firmware needs at least ${MATTER_MIN_FLASH_MB} MB flash.`);
			else if (slot.board.flashMB < 8 && slot.chip.id !== 'esp32h2')
				push(
					'info',
					scope,
					`${slot.board.flashMB} MB flash: two OTA slots fit, but leave little room to grow.`
				);
			if (slot.chip.note) push('info', scope, slot.chip.note);
		}
		const req = slot.id === MAIN ? kind.mainSlot.requires : slot.def?.requires;
		for (const m of requirementIssues(slot.board, req, slot.name)) push('error', scope, m);
		if (slot.board.generic)
			push('info', scope, 'Generic module: double-check that the pins you pick are broken out.');
		if (slot.board.usb === 'none')
			push('info', scope, 'No USB on this board: flash it with a 3.3 V USB-UART adapter.');
		if (slot.wired) issues.push(...wiredIssues(slot, `feature:${slot.by}`));
	}

	// Kind rules ----------------------------------------------------------------------------
	issues.push(
		...kind.rules({
			providers: (cap) => r.provided.get(cap) ?? [],
			peripheralCount: r.peripherals.length
		})
	);

	// Plugins ------------------------------------------------------------------------------
	const groups = new Map<string, string[]>();
	const plugins = [
		...r.features.map((f) => ({
			def: f.def,
			settings: f.settings,
			scope: `feature:${f.def.id}`,
			name: f.def.name
		})),
		...r.peripherals.map((s) => ({
			def: s.def,
			settings: s.instance.settings,
			scope: `peripheral:${s.instance.uid}`,
			name: s.instance.name
		}))
	];
	for (const { def, settings, scope, name } of plugins) {
		for (const m of requirementIssues(main.board, def.requires, name)) push('error', scope, m);
		for (const cap of def.needs ?? [])
			if (!r.has(cap)) push('error', scope, `${name} needs ${describeCapability(cap)}.`);
		for (const cap of def.wants ?? [])
			if (!r.has(cap))
				push('warning', scope, `${name} works best with ${describeCapability(cap)}.`);
		if (def.type === 'feature' && def.group)
			groups.set(def.group, [...(groups.get(def.group) ?? []), name]);
		issues.push(...fieldIssues(def.fields, settings, scope, level));
		const custom = def.validate?.(pluginContext(r, settings, scope, def.fields)) ?? [];
		// Hints about per-device values belong to the devices (their values are checked there).
		const perDevice = (key?: string) =>
			!!key && !!def.fields?.find((f) => f.key === key && isPerDevice(f));
		issues.push(
			...custom
				.filter((i) => level === 'device' || i.severity === 'error' || !perDevice(i.field))
				.map((i) => ({ ...i, scope }))
		);
	}
	for (const [group, names] of groups)
		if (names.length > 1)
			push('error', 'device', `Only one ${group} can be enabled: ${names.join(', ')}.`);

	// Pins -----------------------------------------------------------------------------------
	issues.push(...pinIssues(config, r));

	return issues;
}

/**
 * What is wrong with one device of a firmware: its per-device values (as `validate` sees them in
 * the configuration the device gets) and its own settings. Firmware problems aren't repeated.
 */
export function validateDevice(
	firmware: FirmwareConfig,
	device: DeviceSettings,
	name: string
): Issue[] {
	const config = effectiveConfig(firmware, device, name);
	const fieldsOf = (scope: string): Field[] =>
		(scope.startsWith('feature:')
			? resolve(config).features.find((f) => `feature:${f.def.id}` === scope)?.def.fields
			: resolve(config).peripherals.find((s) => `peripheral:${s.instance.uid}` === scope)?.def
					.fields) ?? [];
	const issues = validate(config, resolve(config), 'device').filter((i) => {
		if (!i.scope || !i.field) return false;
		const field = fieldsOf(i.scope).find((f) => f.key === i.field);
		return !!field && isPerDevice(field);
	});
	if (KINDS[config.kind].matterDevice && !validPasscode(device.matter.passcode))
		issues.push({
			severity: 'error',
			scope: 'device',
			field: 'passcode',
			message: 'The Matter setup passcode is not allowed – generate a new one.'
		});
	if (device.hostname && !HOSTNAME.test(device.hostname))
		issues.push({
			severity: 'error',
			scope: 'device',
			field: 'hostname',
			message: 'Hostname: lowercase letters, digits and dashes, not at the start or end.'
		});
	if (!device.uiPasswordHash)
		issues.push({
			severity: 'error',
			scope: 'device',
			field: 'uiPasswordHash',
			message: 'Set an admin password.'
		});
	return issues;
}

/** A slot the main board flashes over a wire: the chip must support it, the UART be on UART0. */
function wiredIssues(slot: ResolvedSlot, scope: string): Issue[] {
	const link = slot.def?.flashOverWire;
	const pins = slot.wired;
	if (!link || !pins) return [];
	const rom = slot.chip.rom;
	if (!rom)
		return [
			{
				severity: 'error',
				scope: `board:${slot.id}`,
				message: `${slot.name}: the ${slot.chip.name} can't be switched to download mode by software, so the main board can't update it – pick an ESP32-C3, -S3, -C5, -C6 or -H2.`
			}
		];
	const issues: Issue[] = [];
	const check = (key: string, pin: number, want: number, what: string) => {
		if (pin >= 0 && pin !== want)
			issues.push({
				severity: 'error',
				scope,
				field: key,
				message: `${slot.name} ${what} must be ${pinLabel(slot.board, want)}: the main board updates it over this line, and in download mode the chip only listens on UART0.`
			});
	};
	check(link.slotTx, pins.slotTx, rom.uart.tx, 'TX');
	check(link.slotRx, pins.slotRx, rom.uart.rx, 'RX');
	return issues;
}

function pinIssues(config: FirmwareConfig, r: Resolved): Issue[] {
	const issues: Issue[] = [];
	const wifi = r.has('wifi');
	const seen = new Map<string, { owner: string; label: string; role?: string }>();
	for (const entry of pinFields(config)) {
		const { field, settings, scope, owner } = entry;
		const gpio = Number(settings[field.key]);
		if (gpio < 0) continue;
		const slot = r.slot(field.slot ?? MAIN);
		const board = slot.board;
		const problem = pinProblem(board, gpio, field.use, { wifi: wifi && slot.id === MAIN });
		if (problem) {
			issues.push({
				severity: 'error',
				scope,
				field: field.key,
				message: `${field.label}: ${problem}`
			});
			continue;
		}
		// The BOOT pin as a slot's update trigger is what it's meant for.
		const bootTrigger =
			field.role === 'button' &&
			board.button?.gpio === gpio &&
			slot.def?.flashOverWire?.slotTrigger === field.key;
		const warning = bootTrigger ? undefined : pinWarning(board, gpio);
		if (warning)
			issues.push({
				severity: 'warning',
				scope,
				field: field.key,
				message: `${field.label}: ${warning}`
			});
		const key = `${slot.id}:${gpio}`;
		const other = seen.get(key);
		const shared = other && field.role?.startsWith('i2c-') && other.role === field.role;
		if (other && !shared)
			issues.push({
				severity: 'error',
				scope,
				field: field.key,
				message: `${field.label}: ${pinLabel(board, gpio)} is already used by ${other.owner} (${other.label}).`
			});
		if (!other) seen.set(key, { owner, label: field.label, role: field.role });
	}
	return issues;
}

function describeCapability(cap: string): string {
	const known: Record<string, string> = {
		ip: 'an IP network (Wi-Fi, Ethernet or Thread)',
		uplink: 'a network uplink (Wi-Fi or Ethernet)',
		http: 'the HTTP server',
		'matter-controller': 'the Matter controller',
		'matter-transport': 'a Matter transport (Wi-Fi or Thread)',
		wifi: 'Wi-Fi',
		thread: 'Thread',
		otel: 'OpenTelemetry'
	};
	if (cap.startsWith('ui-page:')) return `the "${cap.slice(8)}" page of the web interface`;
	return known[cap] ?? `"${cap}"`;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === 'error');
