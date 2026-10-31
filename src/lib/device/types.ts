/**
 * Core types for the firmware generator.
 *
 * The generator is built from three kinds of building blocks:
 *
 *  - **Boards** (`boards/`) describe physical hardware: chip, pins, flash, PSRAM.
 *  - **Features** (`features/<name>/`) are self-contained building blocks (Wi-Fi, Thread border
 *    router, Matter controller, HTTP server, ...). Each one declares its settings and, activated on a
 *    chip (`FeatureDef.activate`), registers what it brings with the chip's services (`services.ts`):
 *    its firmware (sdkconfig options, dependencies, source files, code snippets), its settings
 *    editor, web UI panels, REST API routes ...
 *  - **Templates** (`templates/<name>.ts`) are ready-made starting points, e.g. the "Matter Thread Hub"
 *    (ESP32-S3 host + ESP32-H2 Thread radio).
 *
 * A device (`ProjectConfig`) consists of one or more *chips*; each chip has a board and its own
 * set of features and is built and flashed separately. Internally a chip is a *role*.
 *
 * To add a feature: create its folder under `features/` and register it in `registry.ts`. Nothing else needs to
 * change.
 */

import type { ServiceKey } from './services';

export type Chip = 'esp32' | 'esp32s3' | 'esp32c3' | 'esp32c6' | 'esp32h2';

export type Framework = 'esp-matter' | 'esp-idf';

// ---------------------------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------------------------

export type PinKind = 'gpio' | 'power' | 'gnd' | 'ctrl';

export interface PinDef {
	/** Silkscreen label, e.g. `17`, `TX`, `5V`, `GND`. */
	label: string;
	kind: PinKind;
	gpio?: number;
	/** Extra functions shown in the pin table, e.g. `U0TXD`, `ADC1_CH0`, `strapping`. */
	functions?: string[];
	/** Pin should not be used for peripherals (flash/PSRAM, USB, strapping ...). */
	reserved?: string;
	/** Shown below the wiring diagram when a wire uses this pin, e.g. a jumper to solder first. */
	note?: string;
}

export interface BoardDef {
	id: string;
	name: string;
	chip: Chip;
	description: string;
	/** Header pins as printed on the board, top to bottom (USB connector at the top). */
	headers: { left: PinDef[]; right: PinDef[] };
	flashSizeMB: number;
	psram: 'none' | 'quad' | 'octal';
	/** Which serial interface the USB connector exposes (decides console + flashing hints). */
	usb: 'usb-serial-jtag' | 'uart-bridge' | 'both';
	ledGpio?: number;
	ledType?: 'ws2812' | 'gpio';
	bootButtonGpio?: number;
	url?: string;
}

// ---------------------------------------------------------------------------------------------
// Settings (edited by the editor the feature registers, `configuratorEditors`, checked on client and server)
// ---------------------------------------------------------------------------------------------

export type FeatureConfig = Record<string, string | number | boolean>;

/** A problem with a feature's settings; with `field`, it is shown at that setting. */
export type FeatureIssue<C extends FeatureConfig = FeatureConfig> =
	string | { field: keyof C & string; message: string };

/** A setting holding a GPIO number. */
export interface GpioSetting {
	key: string;
	label: string;
	/** Allows "not connected" (-1). */
	optional?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------------------------

export type SdkconfigValue = string | number | boolean;

export interface IdfDependency {
	version?: string;
	path?: string;
	rules?: { if: string }[];
}

/**
 * A panel of the web interface served by the ESP itself: a Svelte component in the
 * registering feature's `device-ui/` folder (`devicePanels`), placed by the role's layout.
 */
export interface DevicePanel {
	id: string;
	title: string;
	/** File name inside the feature's `device-ui/` folder, e.g. `ThreadPanel.svelte`. */
	file: string;
	/** Id of the page it is shown on (`DevicePage.id`); omitted: the page that takes the others. */
	page?: string;
	/**
	 * Layout area. Every layout understands `main` and `side`; the admin dashboard also `status` (a badge
	 * in the header, on every section). Custom layouts may add more.
	 */
	area?: string;
	/**
	 * Section of the admin dashboard (`/admin#/<section>`): `devices`, `automations`, `network`, `users`
	 * or `system` (default). Not used on the user dashboard.
	 */
	section?: string;
	/** JSON-serializable props passed to the panel (build-time config). */
	props?: Record<string, unknown>;
}

/**
 * A page of the device web interface ("Web interface"), registered by a feature (`devicePages`): its
 * layout (in that feature's `device-ui/` folder) shows the panels of the chip's features that name it.
 */
export interface DevicePage {
	/** Embedded as `main/<id>.html.gz`; panels name it in `DevicePanel.page`. */
	id: string;
	/** Served there (`mesp_web_add_page`), e.g. `/` or `/admin`. */
	path: string;
	/** Label of its tab in the page menu. */
	title: string;
	/** Icon of its tab: a Lucide icon name, e.g. `settings`. */
	icon?: string;
	/** Layout component in the feature's `device-ui/` folder. */
	layout: string;
	/** `admin`: admins only; `user`: every logged-in user. */
	access: 'admin' | 'user';
	/** Name of its home screen app. */
	appName: string;
	/** Shows the panels that don't name a page. */
	collectsPanels?: boolean;
}

/**
 * A route of the device's REST API (`mesp_web_add()`), as the feature that adds it documents it
 * (registered with the HTTP server's `webServer`). Shown by the HTTP server's API tab of the configurator.
 */
export interface DeviceApiRoute {
	method: 'GET' | 'POST';
	/** E.g. `/api/wifi`. */
	path: string;
	/** One line, e.g. `Switch to another network`. */
	summary: string;
	description?: string;
	/** `public`: no login; `user`: every logged-in account (users see only what they may); `admin`. */
	access: 'public' | 'user' | 'admin';
	/** Fields of the url-encoded body (POST) or query (GET). */
	params?: DeviceApiParam[];
	/** The body when it is not form fields, e.g. `application/octet-stream` (OTA). */
	rawBody?: { type: string; description: string };
	/** An example of the JSON it answers with. */
	response?: unknown;
}

export interface DeviceApiParam {
	name: string;
	type: 'string' | 'number' | 'boolean';
	description: string;
	required?: boolean;
}

/** A page in the page menu of the device web interface. */
export type DevicePageLink = Pick<DevicePage, 'id' | 'path' | 'title' | 'icon' | 'access'>;

/** Everything needed to build a role's device web interface (see `src/lib/server/device-ui`). */
export interface DeviceUiSpec {
	/** `DevicePage.id`, embedded as `main/<page>.html.gz`. */
	page: string;
	/** Layout component, relative to `src/lib/device/`. */
	layout: string;
	/** Served at this path (`mesp_web_add_page`). */
	path: string;
	appName: string;
	device: { name: string; typeName: string; roleName: string };
	/** All pages of the chip, in menu order. */
	pages: DevicePageLink[];
	panels: (Omit<DevicePanel, 'file' | 'page'> & {
		area: string;
		section: string;
		module: string;
	})[];
}

/** Code snippets inserted into the generated `app_main.cpp` at well-defined points. */
export interface CodeHooks {
	/** `#include` lines (without the `#include` keyword is NOT allowed – write the full line). */
	includes?: string[];
	/** Top-level declarations (static helpers, globals). */
	globals?: string[];
	/** Runs first in app_main, after NVS init and before the framework is started. */
	preStart?: string[];
	/** Runs after the framework (Matter stack / OpenThread) has been started. */
	postStart?: string[];
	/** Runs last, after the `postStart` of every feature (e.g. the web server, once all routes are added). */
	started?: string[];
	/** Runs once when the station interface got an IP address. */
	onIp?: string[];
}

/**
 * Hardware outside the chips that wires go through, e.g. a logic level converter or the
 * connector of an appliance. Drawn like a board in the wiring diagram; wires refer to it with
 * `role: 'part:<id>'` and the pin label.
 */
export interface PartDef {
	id: string;
	name: string;
	subtitle?: string;
	/** Pins top to bottom, like a board's headers. */
	headers: { left: PinDef[]; right: PinDef[] };
	/** Shown below the diagram (how to connect it safely). */
	note?: string;
}

export interface Wire {
	/** A chip id, or `part:<id>` for an external part. */
	from: { role: string; pin: string };
	to: { role: string; pin: string };
	/** Signal name shown on the wire, e.g. `UART TX → RX`. */
	label: string;
	color: string;
	optional?: boolean;
}

export interface Contribution {
	sdkconfig?: Record<string, SdkconfigValue>;
	/** `#define`s written to the generated `main/espm_config.h` (strings become C string literals). */
	defines?: Record<string, SdkconfigValue>;
	/** Extra global compile options (added to the project CMakeLists). */
	compileOptions?: string[];
	/** Extra linker flags of the app, e.g. `-Wl,--wrap=symbol` to patch a library function. */
	linkOptions?: string[];
	dependencies?: Record<string, IdfDependency>;
	/** Extra files in `main/`, keyed by file name. */
	sources?: Record<string, string>;
	/** Extra files in the project root (e.g. `partitions.csv`). */
	rootFiles?: Record<string, string>;
	hooks?: CodeHooks;
	/** Human readable notes shown on the build page (e.g. "flash the RCP first"). */
	notes?: string[];
}

export interface GenerateContext<C extends FeatureConfig = FeatureConfig> {
	project: ProjectConfig;
	role: RoleDef;
	board: BoardDef;
	/** Config of the feature being generated (defaults already applied). */
	config: C;
	/** The features of this chip, in hook order. */
	features: FeatureDef[];
	/** The pages of the web interface the chip's features declare, in menu order. */
	pages(): (DevicePage & { dir: string })[];
	/** Look up the (defaulted) config of a feature, by default in the same role. */
	featureConfig(id: string, roleId?: string): FeatureConfig | undefined;
	/** Board of another role in the same project (for wiring-dependent code). */
	boardFor(roleId: string): BoardDef;
	/** Is a feature enabled in this role (or another role)? */
	has(featureId: string, roleId?: string): boolean;
	/** Ids of the chips (roles) of this device that have a feature. */
	chipsWith(featureId: string): string[];
	/** Name of a chip (role) of this device. */
	chipName(roleId: string): string;
}

/** What `FeatureDef.activate` gets: the context plus the chip's services. */
export interface ActivateContext<
	C extends FeatureConfig = FeatureConfig
> extends GenerateContext<C> {
	/** A service of the chip; throws when the feature that brings it isn't on the chip. */
	use<T>(key: ServiceKey<T>): T;
	/** A service of the chip, if the feature that brings it is on the chip. */
	find<T>(key: ServiceKey<T>): T | undefined;
}

/** A feature's `validate`: only its own settings can be a `field`. */
export type Validate<C extends FeatureConfig> = (ctx: GenerateContext<C>) => FeatureIssue<C>[];

/**
 * A feature, typed by its settings `C`. `defaults`, `validate` and `activate` are methods, so a
 * `FeatureDef<C>` is a `FeatureDef`: the generator only passes them the feature's own settings.
 * (`validate` can be a `Validate<C>`; the interface can't say so and stay that way.)
 */
export interface FeatureDef<C extends FeatureConfig = FeatureConfig> {
	id: string;
	/**
	 * Folder under `features/` holding `index.ts`, `firmware/` and `device-ui/` (its panels and
	 * layouts) – both go onto the device – and `configurator/` (its settings editor … in the web app).
	 */
	dir: string;
	name: string;
	description: string;
	category: 'core' | 'network' | 'thread' | 'matter' | 'ui' | 'hardware';
	/** Omitted: the framework of the features it requires (`requiredFeatures`), or any. */
	framework?: Framework;
	/** Restrict to chips; omitted means any chip. */
	chips?: Chip[];
	/** Part of every chip; cannot be removed. */
	always?: boolean;
	/** Flash chips with this feature before the others (e.g. the Thread radio). */
	flashFirst?: boolean;
	/**
	 * Needs two app slots (`ota_0`/`ota_1`), e.g. to install a new firmware while running: the
	 * partition table ("Chip & memory") has them when a feature of the chip sets this and the flash
	 * is large enough (`OTA_MIN_FLASH_MB`).
	 */
	otaSlots?: boolean;
	/** The feature on another board at the other end of its UART (shown in the dependency graph). */
	link?: string;
	/**
	 * Its settings on a new chip with this board. They also give the keys and types: saved settings
	 * are coerced to them and unknown keys dropped. The web app edits them with the editor the
	 * feature registers (`configuratorEditors`, props: `ConfiguratorEditorProps` from `config.ts`), if it has one.
	 */
	defaults?(board: BoardDef): C;
	/**
	 * Settings holding a GPIO: checked against the board and each other, and reset to `defaults`
	 * when the board changes.
	 */
	pins?: GpioSetting[];
	/**
	 * Why it can't be added to this board in this device (it is then not offered), e.g. nothing it
	 * could work with. Checked before adding: `config` is empty.
	 */
	unavailable?: (ctx: GenerateContext) => string | undefined;
	/** Problems with its settings or its place in the device (see `config.ts` for checks). */
	validate?(ctx: GenerateContext<C>): FeatureIssue[];
	/**
	 * Runs for each chip with the feature, in hook order: registers what it brings with the chip's
	 * services (`ctx.use(firmware)`, `ctx.use(configuratorEditors)`, `ctx.find(webServer)` …). The
	 * features bringing what it `use`s are its requirements: added with it (`requiredFeatures`). Also runs
	 * while the settings are invalid: anything that needs valid ones goes into the registered
	 * firmware, which is only called when the project is generated.
	 */
	activate?(ctx: ActivateContext<C>): void;
}

// ---------------------------------------------------------------------------------------------
// Devices (projects), chips and templates
// ---------------------------------------------------------------------------------------------

/** One chip of a device: a board with its features, built and flashed as one firmware. */
export interface ChipConfig {
	/** Stable id, used for build artifacts and workspaces (`host`, `radio`, `chip-3`, ...). */
	id: string;
	name: string;
	board: string;
	/** Config per enabled feature id. A feature is enabled when it has an entry. */
	features: Record<string, FeatureConfig>;
}

/** The user-editable, persisted configuration of a device. */
export interface ProjectConfig {
	version: 2;
	/** Device name; also used as hostname and mDNS name. */
	name: string;
	/** Template the device was created from (informational). */
	template?: string;
	chips: ChipConfig[];
}

/** A chip as the generator sees it, derived from `ChipConfig` and its features. */
export interface RoleDef {
	id: string;
	name: string;
	framework: Framework;
	/** Features in hook order. */
	features: string[];
	/** Lower numbers are flashed first. */
	flashOrder: number;
}

/** A ready-made device to start from. */
export interface TemplateDef {
	id: string;
	name: string;
	tagline: string;
	description: string;
	/** Chips with their features; feature config defaults are filled in automatically. */
	chips: { id: string; name: string; board: string; features: Record<string, FeatureConfig> }[];
}

export interface GeneratedProject {
	role: RoleDef;
	board: BoardDef;
	target: Chip;
	files: Record<string, string>;
	/** Pages of the device web interface; the build server compiles each into `main/<page>.html.gz`. */
	ui: DeviceUiSpec[];
	notes: string[];
}
