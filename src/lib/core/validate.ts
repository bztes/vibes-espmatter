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
	type Settings,
	type SlotDef
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
import { effectiveConfig, HOSTNAME } from './device';
import { KINDS } from './kinds';
import { appLink } from './link';
import { validPasscode } from './matter';
import { MAIN, type DeviceSettings, type FirmwareConfig } from './model';
import { boards } from './registry';

/** Minimum flash for a Matter firmware, and with two OTA slots. */
const MATTER_MIN_FLASH_MB = 4;

type Requirements = (HardwareRequirements | undefined)[];

/** What a slot's board must have: the main board everything the kind, features and peripherals need. */
export function slotRequirements(r: Resolved, slotId = MAIN, without?: string): Requirements {
	if (slotId !== MAIN) return [r.slot(slotId).def?.requires];
	return [
		KINDS[r.config.kind].mainSlot.requires,
		...r.features.filter((f) => !without || f.def.group !== without).map((f) => f.def.requires),
		...r.peripherals.map((p) => p.def.requires)
	];
}

export function boardFits(
	board: BoardDef,
	reqs: Requirements,
	framework: ResolvedSlot['framework']
) {
	const chip = CHIPS[board.chip];
	if (framework === 'esp-matter' && (chip.matterUnsupported || board.flashMB < MATTER_MIN_FLASH_MB))
		return false;
	return reqs.every((req) => !requirementIssues(board, req, '').length);
}

/** Boards that run a slot, in catalog order. */
export const fittingBoards = (reqs: Requirements, framework: ResolvedSlot['framework']) =>
	boards.all().filter((b) => boardFits(b, reqs, framework));

/** Why a plugin can't be added: no board runs it together with what is enabled. */
export function noBoardFor(
	r: Resolved,
	def: { name: string; group?: string; requires?: HardwareRequirements; slots?: SlotDef[] }
): string | undefined {
	// It replaces the enabled feature of its group.
	const reqs = [...slotRequirements(r, MAIN, def.group), def.requires];
	const main = fittingBoards(reqs, 'esp-matter').length;
	const slots = (def.slots ?? []).every(
		(s) => fittingBoards([s.requires], s.framework ?? 'esp-idf').length
	);
	return main && slots ? undefined : `No board runs ${def.name} together with the rest.`;
}

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

/** Fields without a value here (per-device ones of a firmware) are checked on the device. */
function fieldIssues(fields: Field[] = [], settings: Settings, scope: string): Issue[] {
	const issues: Issue[] = [];
	for (const f of fields) {
		if (!(f.key in settings) || (f.when && !f.when(settings))) continue;
		const value = settings[f.key];
		const err = (message: string) =>
			issues.push({ severity: 'error', scope, field: f.key, message });
		switch (f.type) {
			case 'text': {
				const s = String(value ?? '');
				if (f.required && !s.trim()) err(`${f.label} is required.`);
				else if (f.maxLength && s.length > f.maxLength)
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

export function validate(config: FirmwareConfig, r: Resolved = resolve(config)): Issue[] {
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

	// App link ------------------------------------------------------------------------------
	const link = appLink(r);
	if (link.relay && link.access === 'off')
		push(
			'info',
			'link',
			'Without a tunnel the app can’t reach devices through this hub – they still get their updates through it.'
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
		issues.push(...fieldIssues(def.fields, settings, scope));
		const custom = def.validate?.(pluginContext(r, settings, scope, def.fields)) ?? [];
		issues.push(
			...custom.filter((i) => !i.field || i.field in settings).map((i) => ({ ...i, scope }))
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
 * What is wrong with one device of a firmware: what its values add to the firmware's issues
 * (those aren't repeated), and its own settings.
 */
export function validateDevice(
	firmware: FirmwareConfig,
	device: DeviceSettings,
	name: string
): Issue[] {
	const id = (i: Issue) => [i.severity, i.scope, i.field, i.message].join('|');
	const known = new Set(validate(firmware).map(id));
	const issues = validate(effectiveConfig(firmware, device, name)).filter((i) => !known.has(id(i)));
	if (KINDS[firmware.kind].matterDevice && !validPasscode(device.matter.passcode))
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
