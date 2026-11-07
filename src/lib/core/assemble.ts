/**
 * Runs every enabled plugin's `contribute()` (and the platform core) and collects what they add:
 * firmware per board slot, REST routes, web interface widgets and pages, wiring.
 */
import type {
	ApiRoute,
	Contributor,
	FirmwareBuilder,
	FirmwareContribution,
	InitPhase,
	PartDef,
	SettingValue,
	DefineValue,
	UiPage,
	UiWidget,
	Wire
} from '#sdk';
import { pluginContext, resolve, type Resolved, type ResolvedSlot } from './engine';
import { MAIN, type FirmwareConfig } from './model';
import { ACCOUNTS_API, hasAccounts, platform, PLATFORM_DIR } from './platform';

/** A source file: the plugin folder it comes from and its name in `<dir>/firmware/`. */
export interface SourceRef {
	dir: string;
	file: string;
}

export interface SlotFirmware extends Omit<FirmwareContribution, 'sources'> {
	slot: ResolvedSlot;
	sources: SourceRef[];
	/** Who contributed, for the README and logs. */
	blocks: string[];
}

export interface PlacedWidget extends UiWidget {
	dir: string;
	by: string;
}

export interface Assembly {
	resolved: Resolved;
	firmware: SlotFirmware[];
	api: ApiRoute[];
	widgets: PlacedWidget[];
	pages: (UiPage & { by: string })[];
	parts: PartDef[];
	wires: Wire[];
	notes: string[];
}

/**
 * Peripherals have no web UI: a peripheral is a Matter device type, and Matter controllers (the hub's
 * dashboard among them) bring the UI for each type.
 */
const noPeripheralUi = (name: string) =>
	new Error(`${name}: peripherals can't add web UI – their Matter device types are the interface.`);

/** What only the server knows when it builds. Nothing of a device: that's in its configuration. */
export interface BuildInfo {
	version: number;
	buildId: string;
}

function emptyFirmware(slot: ResolvedSlot): SlotFirmware {
	return {
		slot,
		sources: [],
		generated: {},
		sdkconfig: {},
		defines: {},
		components: {},
		linkOptions: [],
		includes: [],
		init: [],
		partitions: [],
		matter: slot.framework === 'esp-matter',
		blocks: []
	};
}

export function assemble(config: FirmwareConfig, build?: BuildInfo): Assembly {
	const r = resolve(config);
	const firmware = new Map(r.slots.map((s) => [s.id, emptyFirmware(s)]));
	const out: Assembly = {
		resolved: r,
		firmware: [...firmware.values()],
		api: [],
		widgets: [],
		pages: [],
		parts: [],
		wires: [],
		notes: []
	};

	const contributor = (name: string, dir: string, peripheral = false): Contributor => {
		const builders = new Map<string, FirmwareBuilder>();
		const builderFor = (slotId = MAIN): FirmwareBuilder => {
			const fw = firmware.get(slotId);
			if (!fw) throw new Error(`${name}: unknown board slot '${slotId}'`);
			if (!fw.blocks.includes(name)) fw.blocks.push(name);
			const b: FirmwareBuilder = {
				source(...files) {
					for (const file of files)
						if (!fw.sources.some((s) => s.dir === dir && s.file === file))
							fw.sources.push({ dir, file });
					return b;
				},
				generated(file, content) {
					fw.generated[file] = content;
					return b;
				},
				sdkconfig(values: Record<string, SettingValue>) {
					Object.assign(fw.sdkconfig, values);
					return b;
				},
				define(values: Record<string, DefineValue>) {
					Object.assign(fw.defines, values);
					return b;
				},
				component(componentName, version) {
					fw.components[componentName] = version;
					return b;
				},
				link(...options) {
					for (const o of options) if (!fw.linkOptions.includes(o)) fw.linkOptions.push(o);
					return b;
				},
				include(...headers) {
					for (const h of headers) if (!fw.includes.includes(h)) fw.includes.push(h);
					return b;
				},
				init(phase: InitPhase, code: string) {
					fw.init.push({ phase, code, by: name });
					return b;
				},
				partition(pName, type, subtype, sizeKB) {
					if (!fw.partitions.some((p) => p.name === pName))
						fw.partitions.push({ name: pName, type, subtype, sizeKB });
					return b;
				}
			};
			return b;
		};
		return {
			firmware(slot) {
				const id = slot ?? MAIN;
				if (!builders.has(id)) builders.set(id, builderFor(id));
				return builders.get(id)!;
			},
			api: (...routes) => out.api.push(...routes.map((route) => ({ ...route, source: name }))),
			ui: (...widgets) => {
				if (peripheral) throw noPeripheralUi(name);
				out.widgets.push(...widgets.map((w) => ({ ...w, dir, by: name })));
			},
			page: (page) => {
				if (peripheral) throw noPeripheralUi(name);
				out.pages.push({ ...page, by: name });
			},
			part: (part) => out.parts.push(part),
			wire: (...wires) => out.wires.push(...wires),
			note: (text) => out.notes.push(text)
		};
	};

	platform(r, contributor('Platform', PLATFORM_DIR), build);
	for (const { def, settings } of r.features)
		def.contribute(
			pluginContext(r, settings, `feature:${def.id}`, def.fields),
			contributor(def.name, def.dir)
		);
	for (const s of r.peripherals) {
		const ctx = {
			...pluginContext(r, s.instance.settings, `peripheral:${s.instance.uid}`, s.def.fields),
			instance: { uid: s.instance.uid, name: s.instance.name, index: s.index, endpoint: s.endpoint }
		};
		s.def.contribute(ctx, contributor(s.instance.name, s.def.dir, true));
	}

	// Widgets only show on pages some feature provides.
	const pageIds = new Set(out.pages.map((p) => p.id));
	out.widgets = out.widgets
		.filter((w) => pageIds.has(w.page))
		.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
	out.pages.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
	if (out.pages.length && r.has('ip')) {
		const accounts = hasAccounts(r);
		out.api.unshift(
			{
				method: 'POST',
				path: '/api/v1/auth/login',
				summary: 'Log in to the web interface',
				description: accounts
					? 'Returns a session token (kept in RAM until restart) to use as Bearer token, like the API token. `admin` is the built-in admin with the password set in the app; other accounts are created on the hub. A session of a user (not admin) may only call the routes that say so, and sees only what it has grants for. `mustChange`: the account has a generated password and may only change it (`/api/v1/auth/password`).'
					: 'Returns a session token (kept in RAM until restart) to use as Bearer token, like the API token.',
				auth: 'public',
				params: [
					...(accounts
						? [
								{
									name: 'user',
									type: 'string' as const,
									description: 'Account name (default `admin`)',
									in: 'body' as const
								}
							]
						: []),
					{
						name: 'password',
						type: 'string',
						description: accounts ? 'Password of the account' : 'Admin password',
						required: true,
						in: 'body'
					}
				],
				response: { token: '9f2c41d0…', user: 'admin', admin: true },
				source: 'Platform'
			},
			{
				method: 'GET',
				path: '/api/v1/auth/me',
				summary: 'Who is logged in',
				description: accounts ? 'Any account.' : undefined,
				auth: 'token',
				response: { ok: true, user: 'admin', admin: true },
				source: 'Platform'
			},
			...(accounts ? ACCOUNTS_API.map((a) => ({ ...a, source: 'Platform' })) : [])
		);
	}
	return out;
}
