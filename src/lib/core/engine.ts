/**
 * Working with a `FirmwareConfig`: which plugins and boards are in play (`resolve`), defaults and
 * coercion (`normalize`), and edits the configurator makes (`addPeripheral`, `setBoard` …).
 * Isomorphic: runs in the browser for live feedback and on the server before saving and building.
 */
import {
	CHIPS,
	type CExpr,
	type BoardDef,
	type ChipDef,
	type DefaultContext,
	type DeviceKind,
	type FeatureDef,
	type FlashOverWire,
	type Field,
	type GpioField,
	type PluginContext,
	type Settings,
	type SettingValue,
	type PeripheralDef,
	type SlotDef
} from '#sdk';
import { KINDS } from './kinds';
import { cfgExpr, cfgType, nvsNamespace } from './cfg';
import { MAIN, TEST_VENDOR_ID, type FirmwareConfig, type PeripheralInstance } from './model';
import { boards, features, peripherals, type Registered } from './registry';

export interface ResolvedSlot {
	id: string;
	name: string;
	board: BoardDef;
	chip: ChipDef;
	/** The feature that brings it (none for the main slot). */
	by?: string;
	def?: SlotDef;
	framework: 'esp-idf' | 'esp-matter';
	flashFirst: boolean;
	/** The main board flashes this slot over the wires between them: their GPIOs. */
	wired?: WiredPins;
}

export type WiredPins = Record<keyof FlashOverWire, number>;

export interface ResolvedFeature {
	def: Registered<FeatureDef>;
	settings: Settings;
}

export interface ResolvedPeripheral {
	def: Registered<PeripheralDef>;
	instance: PeripheralInstance;
	index: number;
	endpoint: number;
}

export interface Resolved {
	config: FirmwareConfig;
	slots: ResolvedSlot[];
	features: ResolvedFeature[];
	peripherals: ResolvedPeripheral[];
	/** capability → plugin names providing it. */
	provided: Map<string, string[]>;
	slot(id?: string): ResolvedSlot;
	has(capability: string): boolean;
}

const FALLBACK_BOARD = 'esp32-c6-devkitc-1';

export function boardOrDefault(id: string | undefined, fallback = FALLBACK_BOARD): BoardDef {
	return (id && boards.find(id)) || boards.find(fallback) || boards.all()[0];
}

/** Features of a kind, in catalog order. */
export const featuresFor = (kind: DeviceKind) =>
	features.all().filter((f) => f.kinds.includes(kind));

export function resolve(config: FirmwareConfig): Resolved {
	const mainBoard = boardOrDefault(config.boards[MAIN], KINDS[config.kind].defaultBoard);
	const resolvedFeatures: ResolvedFeature[] = Object.entries(config.features).flatMap(
		([id, settings]) => {
			const def = features.find(id);
			return def && def.kinds.includes(config.kind) ? [{ def, settings }] : [];
		}
	);
	// Catalog order, so contributions are deterministic.
	const order = features.all().map((f) => f.id);
	resolvedFeatures.sort((a, b) => order.indexOf(a.def.id) - order.indexOf(b.def.id));

	const slots: ResolvedSlot[] = [
		{
			id: MAIN,
			name: KINDS[config.kind].mainSlot.name,
			board: mainBoard,
			chip: CHIPS[mainBoard.chip],
			framework: 'esp-matter',
			flashFirst: false
		}
	];
	for (const { def, settings } of resolvedFeatures) {
		for (const slot of def.slots ?? []) {
			if (slots.some((s) => s.id === slot.id)) continue;
			const board = boardOrDefault(config.boards[slot.id], slot.defaultBoard);
			const link = slot.flashOverWire;
			slots.push({
				id: slot.id,
				name: slot.name,
				board,
				chip: CHIPS[board.chip],
				by: def.id,
				def: slot,
				framework: slot.framework ?? 'esp-idf',
				flashFirst: !!slot.flashFirst,
				wired: link
					? (Object.fromEntries(
							Object.entries(link).map(([k, key]) => [k, Number(settings[key] ?? -1)])
						) as WiredPins)
					: undefined
			});
		}
	}

	const resolvedPeripherals: ResolvedPeripheral[] = [];
	if (KINDS[config.kind].peripherals) {
		const counts = new Map<string, number>();
		let endpoint = 1;
		for (const instance of config.peripherals) {
			const def = peripherals.find(instance.peripheral);
			if (!def) continue;
			const index = counts.get(def.id) ?? 0;
			counts.set(def.id, index + 1);
			resolvedPeripherals.push({ def, instance, index, endpoint });
			endpoint += def.matter.endpoints.length;
		}
	}

	const provided = new Map<string, string[]>();
	const add = (cap: string, by: string) => provided.set(cap, [...(provided.get(cap) ?? []), by]);
	for (const { def } of resolvedFeatures) for (const cap of def.provides ?? []) add(cap, def.name);
	for (const { def } of resolvedPeripherals)
		for (const cap of def.provides ?? []) add(cap, def.name);

	return {
		config,
		slots,
		features: resolvedFeatures,
		peripherals: resolvedPeripherals,
		provided,
		slot: (id = MAIN) => slots.find((s) => s.id === id) ?? slots[0],
		has: (cap) => provided.has(cap)
	};
}

/** The context plugins see. `scope`: `feature:<id>` / `peripheral:<uid>`, for `cfg()`. */
export function pluginContext<S extends Settings>(
	r: Resolved,
	settings: S,
	scope: string,
	fields: Field[] = []
): PluginContext<S> {
	return {
		settings,
		device: { name: r.config.name, kind: r.config.kind },
		cfg(key): CExpr {
			const field = fields.find((f) => f.key === key);
			if (!field?.perDevice || field.type === 'gpio')
				throw new Error(`${scope}: '${key}' is no per-device field`);
			return cfgExpr(nvsNamespace(scope), key, cfgType(field), settings[key]);
		},
		board: (slot) => r.slot(slot).board,
		chip: (slot) => r.slot(slot).chip,
		has: (cap) => r.has(cap)
	};
}

// ---------------------------------------------------------------------------------------------
// Defaults & normalization
// ---------------------------------------------------------------------------------------------

function defaultContext(board: BoardDef, deviceName: string): DefaultContext {
	return { board, chip: CHIPS[board.chip], deviceName };
}

function fieldDefault(field: Field, ctx: DefaultContext): SettingValue {
	return typeof field.default === 'function'
		? (field.default as (c: DefaultContext) => SettingValue)(ctx)
		: field.default;
}

function coerce(field: Field, value: unknown, fallback: SettingValue): SettingValue {
	if (value === undefined || value === null) return fallback;
	switch (field.type) {
		case 'boolean':
			return value === true || value === 'true' || value === 'on' || value === 1;
		case 'number':
		case 'gpio': {
			const n = Number(value);
			return Number.isFinite(n) ? n : fallback;
		}
		case 'select': {
			const s = String(value);
			return field.options.some((o) => o.value === s) ? s : fallback;
		}
		default:
			return String(value).slice(0, 512);
	}
}

/** A value of the right type for a field (`fallback` when it can't be one). */
export { coerce as coerceSetting };

/** Settings with every field present and of the right type. Unknown keys are dropped. */
export function normalizeSettings(
	fields: Field[] = [],
	raw: unknown,
	ctx: DefaultContext
): Settings {
	const values = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	return Object.fromEntries(
		fields.map((f) => [f.key, coerce(f, values[f.key], fieldDefault(f, ctx))])
	);
}

function slotBoardFor(
	slotId: string,
	config: Pick<FirmwareConfig, 'boards' | 'kind'>,
	slotDef?: SlotDef
) {
	return slotId === MAIN
		? boardOrDefault(config.boards[MAIN], KINDS[config.kind].defaultBoard)
		: boardOrDefault(config.boards[slotId], slotDef?.defaultBoard);
}

/** Board a field's pins are on. */
function fieldBoard(
	field: Field,
	config: Pick<FirmwareConfig, 'boards' | 'kind'>,
	plugin: { slots?: SlotDef[] }
): BoardDef {
	const slotId = field.type === 'gpio' ? (field.slot ?? MAIN) : MAIN;
	return slotBoardFor(
		slotId,
		config,
		plugin.slots?.find((s) => s.id === slotId)
	);
}

const UID = /^[a-z0-9]{4,12}$/;

/** Easy to read and type: no 0/O, 1/l/I. */
export function randomPassword(length = 12): string {
	const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	return Array.from(
		crypto.getRandomValues(new Uint8Array(length)),
		(b) => chars[b % chars.length]
	).join('');
}

export function newUid(existing: Iterable<string> = []): string {
	const taken = new Set(existing);
	for (;;) {
		const uid = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) =>
			'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(b % 36)
		).join('');
		if (!taken.has(uid) && /^[a-z]/.test(uid)) return uid;
	}
}

export const int = (value: unknown, fallback: number, min: number, max: number) => {
	const n = Math.round(Number(value));
	return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/** Fill in defaults, coerce types and drop unknown keys. Safe on untrusted input. */
export function normalize(raw: unknown): FirmwareConfig {
	const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<FirmwareConfig>;
	const kind: DeviceKind = input.kind === 'hub' ? 'hub' : 'device';
	const name =
		String(input.name ?? '')
			.trim()
			.slice(0, 48) || KINDS[kind].defaultName;
	const rawBoards = (
		input.boards && typeof input.boards === 'object' ? input.boards : {}
	) as Record<string, unknown>;
	const boardsOut: Record<string, string> = {
		[MAIN]: boardOrDefault(String(rawBoards[MAIN] ?? ''), KINDS[kind].defaultBoard).id
	};
	const base = { kind, boards: boardsOut };
	const mainCtx = defaultContext(boards.get(boardsOut[MAIN]), name);

	const featuresOut: Record<string, Settings> = {};
	const rawFeatures = (input.features ?? {}) as Record<string, unknown>;
	for (const def of featuresFor(kind)) {
		if (!(def.id in rawFeatures)) continue;
		for (const slot of def.slots ?? [])
			boardsOut[slot.id] = boardOrDefault(String(rawBoards[slot.id] ?? ''), slot.defaultBoard).id;
		featuresOut[def.id] = normalizeFieldsPerBoard(def, rawFeatures[def.id], base, name);
	}

	const peripheralsOut: PeripheralInstance[] = [];
	if (KINDS[kind].peripherals && Array.isArray(input.peripherals)) {
		for (const raw of input.peripherals.slice(0, 32)) {
			const def = peripherals.find(String(raw?.peripheral));
			if (!def) continue;
			if (!def.multiple && peripheralsOut.some((s) => s.peripheral === def.id)) continue;
			const uid =
				UID.test(String(raw.uid)) && !peripheralsOut.some((s) => s.uid === raw.uid)
					? String(raw.uid)
					: newUid(peripheralsOut.map((s) => s.uid));
			peripheralsOut.push({
				uid,
				peripheral: def.id,
				name:
					String(raw.name ?? '')
						.trim()
						.slice(0, 32) || def.name,
				settings: normalizeSettings(def.fields, raw.settings, mainCtx)
			});
		}
	}

	const m = (input.matter ?? {}) as Partial<FirmwareConfig['matter']>;
	return {
		schema: 2,
		kind,
		name,
		boards: boardsOut,
		features: featuresOut,
		peripherals: peripheralsOut,
		matter: {
			vendorId: int(m.vendorId, TEST_VENDOR_ID, 1, 0xfff4),
			productId: int(m.productId, kind === 'hub' ? 0x8001 : 0x8000, 1, 0xffff)
		}
	};
}

function normalizeFieldsPerBoard(
	def: FeatureDef | PeripheralDef,
	raw: unknown,
	config: Pick<FirmwareConfig, 'boards' | 'kind'>,
	deviceName: string
): Settings {
	const values = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const plugin = def.type === 'feature' ? def : {};
	return Object.fromEntries(
		(def.fields ?? []).map((f) => {
			const ctx = defaultContext(fieldBoard(f, config, plugin), deviceName);
			return [f.key, coerce(f, values[f.key], fieldDefault(f, ctx))];
		})
	);
}

/** A new firmware of a kind with its default features. */
export function createConfig(kind: DeviceKind, name?: string): FirmwareConfig {
	const config = normalize({ kind, name, boards: { [MAIN]: KINDS[kind].defaultBoard } });
	for (const def of featuresFor(kind))
		if (def.defaultOn?.includes(kind)) enableFeature(config, def.id);
	return config;
}

// ---------------------------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------------------------

export function enableFeature(config: FirmwareConfig, id: string) {
	const def = features.get(id);
	// Only one feature of a group.
	if (def.group)
		for (const other of Object.keys(config.features))
			if (features.find(other)?.group === def.group) delete config.features[other];
	for (const slot of def.slots ?? []) config.boards[slot.id] ??= slot.defaultBoard;
	config.features[id] = normalizeFieldsPerBoard(def, {}, config, config.name);
	assignPins(config);
}

export function disableFeature(config: FirmwareConfig, id: string) {
	delete config.features[id];
	const def = features.find(id);
	// Drop slots nobody brings any more.
	const stillUsed = new Set(
		Object.keys(config.features).flatMap((f) => features.find(f)?.slots?.map((s) => s.id) ?? [])
	);
	for (const slot of def?.slots ?? []) if (!stillUsed.has(slot.id)) delete config.boards[slot.id];
}

export function addPeripheral(
	config: FirmwareConfig,
	peripheralId: string,
	name?: string
): PeripheralInstance {
	const def = peripherals.get(peripheralId);
	const count = config.peripherals.filter((s) => s.peripheral === peripheralId).length;
	const instance: PeripheralInstance = {
		uid: newUid(config.peripherals.map((s) => s.uid)),
		peripheral: peripheralId,
		name: name ?? (def.multiple && count ? `${def.name} ${count + 1}` : def.name),
		settings: normalizeSettings(
			def.fields,
			{},
			defaultContext(boardOrDefault(config.boards[MAIN]), config.name)
		)
	};
	config.peripherals.push(instance);
	assignPins(config);
	return instance;
}

export function removePeripheral(config: FirmwareConfig, uid: string) {
	config.peripherals = config.peripherals.filter((s) => s.uid !== uid);
}

/** Switch a slot's board. Pins that don't exist there are freed and assigned again. */
export function setBoard(config: FirmwareConfig, slotId: string, boardId: string) {
	const board = boards.get(boardId);
	config.boards[slotId] = board.id;
	const valid = new Set(boardGpios(board));
	const slotDef = features
		.all()
		.flatMap((f) => f.slots ?? [])
		.find((s) => s.id === slotId);
	for (const entry of pinFields(config)) {
		if ((entry.field.slot ?? MAIN) !== slotId) continue;
		const value = Number(entry.settings[entry.field.key]);
		const rom = romPinFor(board, slotDef, entry.field);
		if (value >= 0 && (!valid.has(value) || (rom !== undefined && rom !== value)))
			entry.settings[entry.field.key] = -1;
	}
	if (slotId === MAIN) switchTransportIfUnsupported(config, board);
	assignPins(config);
}

/** The board can't do the enabled transport (e.g. Wi-Fi on an H2): switch to one it can. */
function switchTransportIfUnsupported(config: FirmwareConfig, board: BoardDef) {
	const caps = new Set<string>(CHIPS[board.chip].capabilities);
	if (board.ethernet) caps.add('ethernet-mac');
	const fits = (f: FeatureDef) => (f.requires?.capabilities ?? []).every((c) => caps.has(c));
	const current = Object.keys(config.features)
		.map((id) => features.find(id))
		.find((f) => f?.group === 'transport');
	if (!current || fits(current)) return;
	const alternative = featuresFor(config.kind).find((f) => f.group === 'transport' && fits(f));
	if (alternative) enableFeature(config, alternative.id);
}

// ---------------------------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------------------------

export interface PinFieldEntry {
	field: GpioField;
	settings: Settings;
	/** `feature:<id>` or `peripheral:<uid>`. */
	scope: string;
	owner: string;
}

/** Every GPIO setting of the enabled plugins. */
export function pinFields(config: FirmwareConfig): PinFieldEntry[] {
	const out: PinFieldEntry[] = [];
	for (const [id, settings] of Object.entries(config.features)) {
		const def = features.find(id);
		for (const field of def?.fields ?? [])
			if (field.type === 'gpio' && (!field.when || field.when(settings)))
				out.push({ field, settings, scope: `feature:${id}`, owner: def!.name });
	}
	for (const instance of config.peripherals) {
		const def = peripherals.find(instance.peripheral);
		for (const field of def?.fields ?? [])
			if (field.type === 'gpio' && (!field.when || field.when(instance.settings)))
				out.push({
					field,
					settings: instance.settings,
					scope: `peripheral:${instance.uid}`,
					owner: instance.name
				});
	}
	return out;
}

/** GPIOs of a board that exist on its headers (or the chip, for generic boards). */
export function boardGpios(board: BoardDef): number[] {
	const chip = CHIPS[board.chip];
	if (board.generic) return chip.gpios.filter((n) => !chip.flashPins.includes(n));
	const pins = [...board.headers.left, ...board.headers.right]
		.filter((p) => p.kind === 'gpio' && p.gpio !== undefined)
		.map((p) => p.gpio!);
	return [...new Set(pins)].sort((a, b) => a - b);
}

/** Why a GPIO can't be used for `use` on a board (hard errors only). */
export function pinProblem(
	board: BoardDef,
	gpio: number,
	use: GpioField['use'],
	opts: { wifi?: boolean } = {}
): string | undefined {
	const chip = CHIPS[board.chip];
	if (!chip.gpios.includes(gpio)) return `${chip.name} has no GPIO${gpio}.`;
	if (!boardGpios(board).includes(gpio))
		return `GPIO${gpio} is not on a header of the ${board.name}.`;
	if (chip.flashPins.includes(gpio)) return `GPIO${gpio} is connected to the flash chip.`;
	if (board.psram === 'octal' && chip.octalPsramPins?.includes(gpio))
		return `GPIO${gpio} is used by the octal PSRAM.`;
	const pin = [...board.headers.left, ...board.headers.right].find((p) => p.gpio === gpio);
	if (pin?.reserved && !['console'].includes(pin.reserved))
		return `GPIO${gpio} is reserved on this board (${pin.reserved}).`;
	if (use !== 'input' && use !== 'analog' && chip.inputOnly?.includes(gpio))
		return `GPIO${gpio} is input only – it can't drive an output.`;
	if (use === 'analog') {
		const channel = chip.adc[gpio];
		if (!channel) return `GPIO${gpio} has no ADC channel.`;
		if (opts.wifi && chip.adc2BlockedByWifi && channel.startsWith('ADC2'))
			return `GPIO${gpio} is on ADC2, which can't be read while Wi-Fi is on – use an ADC1 pin.`;
	}
	return undefined;
}

/** Pins that are fine but deserve a hint. */
export function pinWarning(board: BoardDef, gpio: number): string | undefined {
	const chip = CHIPS[board.chip];
	if (chip.strapping.includes(gpio))
		return `GPIO${gpio} is a strapping pin: external pull-ups/-downs can stop the board from booting.`;
	if (chip.usbPins?.includes(gpio) && board.usb !== 'uart-bridge' && board.usb !== 'none')
		return `GPIO${gpio} is a USB data pin: using it disables USB flashing and the USB console.`;
	const pin = [...board.headers.left, ...board.headers.right].find((p) => p.gpio === gpio);
	if (pin?.reserved === 'console')
		return `GPIO${gpio} is the serial console (log output) – logs will garble the signal.`;
	if (board.led?.gpio === gpio) return `GPIO${gpio} drives the onboard LED.`;
	if (board.button?.gpio === gpio) return `GPIO${gpio} has the onboard button.`;
	return undefined;
}

/** I2C lines may be shared between devices on the same bus. */
const shareable = (a: GpioField, b: GpioField) =>
	!!a.role && a.role === b.role && a.role.startsWith('i2c-');

/**
 * Give every unassigned (-1), required GPIO setting a free pin: the board's bus pin for its role if
 * free (after the field's preferred pin for the chip), otherwise the first pin without warnings.
 */
export function assignPins(config: FirmwareConfig) {
	const entries = pinFields(config);
	const wifi = Object.keys(config.features).includes('wifi');
	const used = (slot: string) =>
		entries
			.filter((e) => (e.field.slot ?? MAIN) === slot && Number(e.settings[e.field.key]) >= 0)
			.map((e) => ({ gpio: Number(e.settings[e.field.key]), field: e.field }));

	for (const entry of entries) {
		const { field, settings } = entry;
		if (Number(settings[field.key]) >= 0 || field.optional) continue;
		const slot = field.slot ?? MAIN;
		const slotDef = features
			.all()
			.flatMap((f) => f.slots ?? [])
			.find((s) => s.id === slot);
		const board = slotBoardFor(slot, config, slotDef);
		const taken = used(slot);
		const free = (n: number) =>
			!pinProblem(board, n, field.use, { wifi }) &&
			taken.every((t) => t.gpio !== n || shareable(t.field, field));

		// Share an already used bus line of the same role first (I2C), then the board's bus pins –
		// for a slot the main board flashes, its UART goes on the pins the ROM listens on.
		const sameRole = taken.find((t) => field.role && shareable(t.field, field));
		const busPin = romPinFor(board, slotDef, field) ?? busPinFor(board, field);
		const candidates = [
			sameRole?.gpio,
			field.prefer?.[board.chip],
			busPin,
			...boardGpios(board).filter((n) => !pinWarning(board, n)),
			...boardGpios(board)
		].filter((n): n is number => n !== undefined);
		const pick = candidates.find(free);
		if (pick !== undefined) settings[field.key] = pick;
	}
}

/** A slot's UART pins when the main board flashes it over a wire: its chip's UART0. */
export function romPinFor(
	board: BoardDef,
	slotDef: SlotDef | undefined,
	field: GpioField
): number | undefined {
	const link = slotDef?.flashOverWire;
	const rom = CHIPS[board.chip].rom;
	if (!link || !rom) return undefined;
	if (field.key === link.slotTx) return rom.uart.tx;
	if (field.key === link.slotRx) return rom.uart.rx;
	return undefined;
}

function busPinFor(board: BoardDef, field: GpioField): number | undefined {
	switch (field.role) {
		case 'i2c-sda':
			return board.buses?.i2c?.sda;
		case 'i2c-scl':
			return board.buses?.i2c?.scl;
		case 'uart-tx':
			return board.buses?.uart?.tx;
		case 'uart-rx':
			return board.buses?.uart?.rx;
		case 'led':
			return board.led?.type === 'gpio' ? board.led.gpio : undefined;
		case 'button':
			return board.button?.gpio;
	}
}

/** The header label of a GPIO, e.g. `TX (GPIO43)` or `GPIO5`. */
export function pinLabel(board: BoardDef, gpio: number): string {
	const pin = [...board.headers.left, ...board.headers.right].find((p) => p.gpio === gpio);
	if (!pin || pin.label === String(gpio)) return `GPIO${gpio}`;
	return `${pin.label} (GPIO${gpio})`;
}
