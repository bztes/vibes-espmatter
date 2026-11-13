/**
 * The plugin contract.
 *
 * Boards, features (hub/system capabilities) and peripherals (the hardware a Matter device drives) are plugins:
 * each lives in its own folder under `plugins/` and imports nothing but `#sdk`. They never import
 * each other – when a plugin needs something another one offers, it names a *capability*
 * (`needs: ['ip']`) and whichever plugin `provides` it satisfies the requirement. That keeps them
 * independent, so they can be moved to their own repositories.
 */

import type { MatterEndpoint } from './matter';
import type { SpotName } from './device-ui/spots.svelte';

// ---------------------------------------------------------------------------------------------
// Chips & boards
// ---------------------------------------------------------------------------------------------

export type ChipId =
	| 'esp32'
	| 'esp32s2'
	| 'esp32s3'
	| 'esp32c2'
	| 'esp32c3'
	| 'esp32c5'
	| 'esp32c6'
	| 'esp32c61'
	| 'esp32h2'
	| 'esp32p4';

/** Hardware capabilities of a chip (or board). */
export type HardwareCapability =
	| 'wifi'
	| 'wifi-5ghz'
	| 'ble'
	| 'ieee802154'
	| 'ethernet-mac'
	| 'usb-otg'
	| 'usb-serial-jtag'
	| 'psram';

export interface ChipDef {
	id: ChipId;
	name: string;
	arch: 'xtensa' | 'riscv';
	cores: number;
	capabilities: HardwareCapability[];
	/** All GPIO numbers the chip has. */
	gpios: number[];
	/** GPIOs without output driver. */
	inputOnly?: number[];
	/** Sampled at reset: usable, but external pulls can break booting. */
	strapping: number[];
	/** Connected to the SPI flash/PSRAM in most modules: never usable. */
	flashPins: number[];
	/** Additionally used by octal PSRAM modules. */
	octalPsramPins?: number[];
	/** Native USB D-/D+. */
	usbPins?: number[];
	/** GPIO → ADC channel name. */
	adc: Record<number, string>;
	/** ADC2 channels can't be used while Wi-Fi is on (classic ESP32). */
	adc2BlockedByWifi?: boolean;
	/** Matter support in esp-matter. `undefined`: supported. */
	matterUnsupported?: string;
	/**
	 * The ROM's serial download mode, for flashing the chip from another board over a wire
	 * (`SlotDef.flashOverWire`). Missing: the chip can't be put into download mode by software.
	 */
	rom?: {
		/** UART0 pins the ROM listens on in download mode. */
		uart: { tx: number; rx: number };
		/** Register bit that makes the next reset enter download mode. */
		forceDownload: { reg: number; mask: number };
	};
	/** Maximum supported flash frequency etc. could follow here; kept small on purpose. */
	note?: string;
}

export type PinKind = 'gpio' | 'power' | 'gnd' | 'ctrl' | 'nc';

export interface PinDef {
	/** Silkscreen label, e.g. `17`, `TX`, `5V`, `GND`. */
	label: string;
	kind: PinKind;
	gpio?: number;
	/** Shown in the pin list, e.g. `U0TXD`, `BOOT`. */
	functions?: string[];
	/** Not usable on this board (e.g. wired to the onboard LED or flash). */
	reserved?: string;
	/** Shown below the wiring diagram when a wire uses this pin. */
	note?: string;
}

export interface BoardDef {
	id: string;
	name: string;
	vendor?: string;
	chip: ChipId;
	description?: string;
	url?: string;
	flashMB: number;
	psram: 'none' | 'quad' | 'octal';
	/** Which serial interface the USB connector exposes (console and flashing). */
	usb: 'usb-serial-jtag' | 'uart-bridge' | 'both' | 'none';
	/** Onboard status LED. */
	led?: { gpio: number; type: 'ws2812' | 'gpio'; activeLow?: boolean };
	/** Onboard user/boot button. */
	button?: { gpio: number };
	/** Recommended bus pins (used when pins are assigned automatically). */
	buses?: { i2c?: { sda: number; scl: number }; uart?: { tx: number; rx: number } };
	/** Header pins as printed on the board, top to bottom (USB connector on top). */
	headers: { left: PinDef[]; right: PinDef[] };
	/** Has an Ethernet PHY wired to the chip. */
	ethernet?: {
		phy: 'LAN8720' | 'IP101' | 'RTL8201';
		mdc: number;
		mdio: number;
		power?: number;
		clock: string;
	};
	/** Generic boards: all GPIOs of a module, no real pinout. */
	generic?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

export type SettingValue = string | number | boolean;
export type Settings = Record<string, SettingValue>;

/** What a field's default may depend on. */
export interface DefaultContext {
	board: BoardDef;
	chip: ChipDef;
	deviceName: string;
}

type Dynamic<T> = T | ((ctx: DefaultContext) => T);

interface FieldBase<T> {
	key: string;
	label: string;
	help?: string;
	default: Dynamic<T>;
	/** Only shown (and validated) when this returns true. */
	when?: (settings: Settings) => boolean;
	/** Advanced settings are collapsed by default. */
	advanced?: boolean;
	/**
	 * Set per device, not compiled into the firmware: the value is stored in the device's
	 * configuration (NVS) and read at runtime – in `contribute()` use `ctx.cfg(key)`, a C
	 * expression, instead of the value. The firmware's value is the default for its devices.
	 * For tweaks only (intervals, offsets, credentials …): whatever changes the firmware's
	 * structure – pins, sensor models, options that add code or pages – stays per firmware.
	 * Keys of per-device fields are at most 15 characters (an NVS key).
	 */
	perDevice?: boolean;
}

export interface TextField extends FieldBase<string> {
	type: 'text';
	required?: boolean;
	maxLength?: number;
	pattern?: { regex: RegExp; message: string };
	placeholder?: string;
	/** Rendered as a password input, masked in the UI. */
	secret?: boolean;
}

export interface NumberField extends FieldBase<number> {
	type: 'number';
	min?: number;
	max?: number;
	step?: number;
	unit?: string;
	integer?: boolean;
}

export interface BooleanField extends FieldBase<boolean> {
	type: 'boolean';
}

export interface SelectField extends FieldBase<string> {
	type: 'select';
	options: { value: string; label: string }[];
}

/** How a GPIO is used, decides which pins are allowed. */
export type GpioUse = 'input' | 'output' | 'io' | 'analog' | 'open-drain';

/** Bus role: lets the configurator suggest the board's recommended bus pins. */
export type GpioRole = 'i2c-sda' | 'i2c-scl' | 'uart-tx' | 'uart-rx' | 'led' | 'button';

export interface GpioField extends FieldBase<number> {
	type: 'gpio';
	use: GpioUse;
	role?: GpioRole;
	/** Board slot the pin is on, default `main`. */
	slot?: string;
	/** Allows "not connected" (-1). */
	optional?: boolean;
	/** Pin to pick first on a chip, before the board's bus pin (e.g. a vendor's reference wiring). */
	prefer?: Partial<Record<ChipId, number>>;
}

export type Field = TextField | NumberField | BooleanField | SelectField | GpioField;

/** A field that may be set per device (GPIOs never are: they are the firmware's hardware). */
export type PerDeviceField = Exclude<Field, GpioField>;

/**
 * A C expression, e.g. reading a per-device value at runtime. Interpolates as its code into
 * init snippets; as a `define()` value it becomes `#define NAME (code)`.
 */
export class CExpr {
	constructor(readonly code: string) {}
	toString() {
		return this.code;
	}
}

/** Values of `#define`s: literals, or C expressions evaluated at runtime. */
export type DefineValue = SettingValue | CExpr;

// ---------------------------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------------------------

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
	severity: Severity;
	message: string;
	/** Where it belongs: `board:<slot>`, `feature:<id>`, `peripheral:<uid>`, `device`. */
	scope?: string;
	/** Setting key inside the scope. */
	field?: string;
}

// ---------------------------------------------------------------------------------------------
// What plugins contribute
// ---------------------------------------------------------------------------------------------

/** A REST route of the device, documented in the configurator. */
export interface ApiRoute {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	/** Relative to the device, e.g. `/api/v1/peripherals/{uid}/state`. */
	path: string;
	summary: string;
	description?: string;
	/** `public`: no token; `token`: Bearer token (API token or UI session). */
	auth: 'public' | 'token';
	/** JSON body fields (POST/PUT), or query parameters (GET). */
	params?: ApiParam[];
	/** Raw body, e.g. a firmware image. */
	rawBody?: { contentType: string; description: string };
	/** Example response. */
	response?: unknown;
	/** Who adds it, filled in by the engine. */
	source?: string;
}

export interface ApiParam {
	name: string;
	type: 'string' | 'number' | 'boolean' | 'object';
	description: string;
	required?: boolean;
	in?: 'query' | 'body';
}

/** Hardware outside the boards, drawn in the wiring diagram (sensor breakout, relay module …). */
export interface PartDef {
	id: string;
	name: string;
	subtitle?: string;
	pins: PinDef[];
	/** Pins on the far side, away from the board (e.g. the high-voltage side of a level converter). */
	outer?: PinDef[];
	/** Shown below the diagram. */
	note?: string;
	color?: string;
}

/** A pin reference: `slot:<id>` + `gpio:<n>` / label, or `part:<id>` + label. */
export interface WireEnd {
	node: string;
	pin: string;
}

export interface Wire {
	from: WireEnd;
	to: WireEnd;
	label: string;
	color?: string;
	optional?: boolean;
}

/** A widget of the device web interface (a Svelte file in the plugin's `ui/` folder). */
export interface UiWidget {
	/** Page the widget is shown on. Pages are provided by features (`provides: ['ui-page:<id>']`). */
	page: string;
	/** File name inside `<plugin>/ui/`. */
	file: string;
	title: string;
	/** Bigger widgets span two columns. */
	wide?: boolean;
	/**
	 * Tab of the page it is shown in, e.g. `Devices`, `Network`, `System` (the admin page groups its
	 * widgets into tabs; default `General`). Tabs are ordered by their first widget.
	 */
	tab?: string;
	/** Shown at the full width without a card and title (e.g. the dashboard's devices). */
	plain?: boolean;
	props?: Record<string, unknown>;
	order?: number;
	/**
	 * Who sees it on hubs with accounts: `admin` (default) or `account` – every account, also users
	 * with grants (the widget shows only what the API gives them).
	 */
	access?: 'admin' | 'account';
}

/**
 * A component a plugin puts into other widgets, at a *spot* they offer (`<Spot name=… />` of
 * `#sdk/device-ui`). It gets the spot's context as props and renders anything – e.g. a button
 * opening a `Dialog` – or nothing for that context. Spots and their contexts: `Spots`.
 */
export interface UiSpotItem {
	spot: SpotName;
	/** File name inside `<plugin>/ui/`. */
	file: string;
	order?: number;
}

/** A page of the device web interface (provided by features). */
export interface UiPage {
	id: string;
	title: string;
	/** Lucide icon name. */
	icon?: string;
	path: string;
	order?: number;
	/** Linked in the user menu instead of the header. */
	menu?: boolean;
}

/** Points in `app_main` where code runs. */
export type InitPhase = 'early' | 'matter' | 'started' | 'network' | 'late';

export interface FirmwareContribution {
	/** Files from the plugin's `firmware/` folder copied to `main/`. */
	sources: string[];
	/** Generated files (name → content) in `main/`. */
	generated: Record<string, string>;
	/** sdkconfig defaults. */
	sdkconfig: Record<string, SettingValue>;
	/** `#define`s in the generated `espm_config.h`. */
	defines: Record<string, DefineValue>;
	/** Managed components (`idf_component.yml`). */
	components: Record<string, string>;
	/** Linker options of the app, e.g. `-Wl,--wrap=<symbol>` to patch a function of a library. */
	linkOptions: string[];
	/** `#include` lines for app_main. */
	includes: string[];
	/** Code snippets run in app_main. */
	init: { phase: InitPhase; code: string; by: string }[];
	/** Extra partitions, e.g. `ota_cache`. */
	partitions: { name: string; type: string; subtype: string; sizeKB: number }[];
	/** Needs the Matter stack on this slot. */
	matter: boolean;
}

// ---------------------------------------------------------------------------------------------
// Plugin definitions
// ---------------------------------------------------------------------------------------------

export type DeviceKind = 'hub' | 'device';

/** What a plugin needs from the board it runs on. */
export interface HardwareRequirements {
	/** All of these. */
	capabilities?: HardwareCapability[];
	/** At least one of these. */
	anyCapability?: HardwareCapability[];
	minFlashMB?: number;
	psram?: boolean;
}

/** An additional board a plugin brings along (e.g. the Thread radio of the border router). */
export interface SlotDef {
	id: string;
	name: string;
	description?: string;
	requires?: HardwareRequirements;
	defaultBoard: string;
	/** Firmware framework of the slot: plain ESP-IDF (no Matter) by default. */
	framework?: 'esp-idf' | 'esp-matter';
	/** Flash it before the main board. */
	flashFirst?: boolean;
	/**
	 * The main board installs this slot's firmware over the wires between them: the main firmware
	 * carries the slot's build and flashes it at boot whenever it differs from what the slot runs.
	 * USB is only needed once, for the first install. Needs a chip with `rom` (C3, S3, C5, C6, H2 …).
	 */
	flashOverWire?: FlashOverWire;
}

/**
 * Keys of the plugin's own GPIO fields that connect main board and slot. The slot's UART must be on
 * its chip's UART0 pins (`ChipDef.rom.uart`), where the ROM listens in download mode.
 */
export interface FlashOverWire {
	/** Main board UART TX (to the slot's RX) and RX. */
	hostTx: string;
	hostRx: string;
	/** The slot's UART TX and RX (its UART0 pins). */
	slotTx: string;
	slotRx: string;
	/** Trigger line: a main board output … */
	hostTrigger: string;
	/** … to a slot input. Held low, the slot restarts into download mode. */
	slotTrigger: string;
}

export interface PluginContext<S extends Settings = Settings> {
	/**
	 * The settings. Per-device fields hold the firmware's default in `contribute()` (read the
	 * device's value with `cfg`), and the device's value when a device is validated.
	 */
	settings: S;
	/** The firmware's name (`kind`: what it is). Devices have names of their own. */
	device: { name: string; kind: DeviceKind };
	/**
	 * The per-device value of a field marked `perDevice`, as a C expression that reads it from
	 * the device's configuration at runtime (a `const char *`, `int`, `double` or `bool`, by field
	 * type), falling back to the firmware's value.
	 */
	cfg(key: string): CExpr;
	/** The board of a slot (`main` by default). */
	board(slot?: string): BoardDef;
	chip(slot?: string): ChipDef;
	/** Is a (logical) capability provided by an enabled plugin? */
	has(capability: string): boolean;
}

export interface PeripheralInstanceInfo {
	/** Stable id of this instance, used in REST paths and firmware identifiers. */
	uid: string;
	/** Display name given by the user. */
	name: string;
	/** Index among the instances of the same peripheral. */
	index: number;
	/** Matter endpoint number assigned to this instance (first one if it has several). */
	endpoint: number;
}

export interface Contributor {
	/** Firmware of a slot (`main` by default). */
	firmware(slot?: string): FirmwareBuilder;
	api(...routes: ApiRoute[]): void;
	/** Features only: peripherals have no web UI (their Matter device types are the interface). */
	ui(...widgets: UiWidget[]): void;
	/** Features only: components in spots of other widgets. */
	spot(...items: UiSpotItem[]): void;
	/** Features only. */
	page(page: UiPage): void;
	part(part: PartDef): void;
	wire(...wires: Wire[]): void;
	note(text: string): void;
}

export interface FirmwareBuilder {
	source(...files: string[]): FirmwareBuilder;
	generated(file: string, content: string): FirmwareBuilder;
	sdkconfig(values: Record<string, SettingValue>): FirmwareBuilder;
	define(values: Record<string, DefineValue>): FirmwareBuilder;
	component(name: string, version: string): FirmwareBuilder;
	/** Linker options, e.g. `-Wl,--wrap=<symbol>` (then define `__wrap_<symbol>` in a source). */
	link(...options: string[]): FirmwareBuilder;
	include(...headers: string[]): FirmwareBuilder;
	init(phase: InitPhase, code: string): FirmwareBuilder;
	partition(name: string, type: string, subtype: string, sizeKB: number): FirmwareBuilder;
}

interface PluginBase<S extends Settings> {
	id: string;
	name: string;
	description: string;
	/** Plugin version (semver), shown in the catalog. */
	version?: string;
	author?: string;
	/** Where the plugin comes from, e.g. a git URL. */
	repository?: string;
	/** Lucide icon name. */
	icon?: string;
	fields?: Field[];
	/** Hardware of the main board. */
	requires?: HardwareRequirements;
	/** Logical capabilities this plugin offers, e.g. `ip`, `uplink`, `ui-page:settings`. */
	provides?: string[];
	/** Logical capabilities that must be provided by some enabled plugin. */
	needs?: string[];
	/** Capabilities that are optional but recommended (warning when missing). */
	wants?: string[];
	/** Additional custom checks. */
	validate?(ctx: PluginContext<S>): Omit<Issue, 'scope'>[];
}

export interface FeatureDef<S extends Settings = Settings> extends PluginBase<S> {
	type: 'feature';
	/** Device kinds it is available for. */
	kinds: DeviceKind[];
	/** Enabled on new devices of these kinds. */
	defaultOn?: DeviceKind[];
	/** Only one enabled feature of a group (e.g. `transport` on devices). */
	group?: string;
	/** Extra boards. */
	slots?: SlotDef[];
	contribute(ctx: PluginContext<S>, out: Contributor): void;
}

export interface PeripheralDef<S extends Settings = Settings> extends PluginBase<S> {
	type: 'peripheral';
	/** Can be added more than once. */
	multiple?: boolean;
	/**
	 * The Matter endpoints the peripheral creates, in order: per endpoint the device type (what it is)
	 * and every application cluster it serves (what it can do). Checked against `#sdk/matter`.
	 */
	matter: { endpoints: MatterEndpoint[] };
	/** Category for the catalog. */
	category?: 'sensor' | 'actuator' | 'climate' | 'lighting' | 'input' | 'other';
	contribute(ctx: PluginContext<S> & { instance: PeripheralInstanceInfo }, out: Contributor): void;
}

export type PluginDef = FeatureDef | PeripheralDef;
