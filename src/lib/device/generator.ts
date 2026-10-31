import { documentedRoutes } from './features/http-server/services';
import { devicePages, devicePanels } from './features/web-ui/services';
import { boardGpios } from './pins';
import { boards, features, templates } from './registry';
import { scoped, Services } from './services';
import { firmware, parts, wires } from './features/core/services';
import type {
	DeviceApiRoute,
	BoardDef,
	ChipConfig,
	FeatureConfig,
	FeatureDef,
	Contribution,
	Framework,
	GenerateContext,
	GeneratedProject,
	ProjectConfig,
	PartDef,
	RoleDef,
	DeviceUiSpec,
	SdkconfigValue,
	DevicePage,
	Wire
} from './types';
import { cDefine, hash, indent, sdkconfigLine, slugify, stableStringify } from './util';

/** esp-matter version pulled from the Espressif component registry. */
const ESP_MATTER_VERSION = '~1.5.1';
/** ESP-IDF version the generated projects are tested with. */
const IDF_VERSION = 'v5.5.6';

/** Board of new chips. */
const DEFAULT_BOARD = 'esp32-s3-devkitc-1';
export const MAX_CHIPS = 4;

// ---------------------------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------------------------

const featureDefaults = (feature: FeatureDef, board: BoardDef): FeatureConfig =>
	feature.defaults?.(board) ?? {};

/** A saved setting as the type of its default. */
function coerce(fallback: string | number | boolean, value: unknown): string | number | boolean {
	if (value === undefined || value === null) return fallback;
	switch (typeof fallback) {
		case 'boolean':
			return value === true || value === 'true' || value === 'on';
		case 'number': {
			const n = Number(value);
			return Number.isFinite(n) ? n : fallback;
		}
		default:
			return String(value);
	}
}

/** Features every chip has. */
const alwaysFeatures = features.all().filter((f) => f.always);

/**
 * Features of a chip in hook order (including the ones every chip has): each after the features it
 * requires (`requiredFeatures`), otherwise in the order they are registered (`registry.ts`).
 */
export function chipFeatures(chip: ChipConfig): FeatureDef[] {
	const ids = new Set([
		...alwaysFeatures.map((f) => f.id),
		...Object.keys(chip.features).filter((id) => features.has(id))
	]);
	const sorted: FeatureDef[] = [];
	const visiting = new Set<string>();
	const visit = (feature: FeatureDef) => {
		if (sorted.includes(feature)) return;
		if (visiting.has(feature.id)) throw new Error(`Features require each other: '${feature.id}'`);
		visiting.add(feature.id);
		for (const req of requiredFeatures(feature)) if (ids.has(req)) visit(features.get(req));
		sorted.push(feature);
	};
	for (const feature of features.all()) if (ids.has(feature.id)) visit(feature);
	return sorted;
}

export function chipBoard(chip: ChipConfig): BoardDef {
	return boards.find(chip.board) ?? boards.get(DEFAULT_BOARD);
}

/**
 * Matter features need the esp-matter framework, the rest builds with plain ESP-IDF. The chip has
 * the features the others require, so their own `framework` is enough (and `requiredFeatures` needs this).
 */
function chipFramework(chip: ChipConfig): Framework {
	return chipFeatures(chip).some((f) => f.framework === 'esp-matter') ? 'esp-matter' : 'esp-idf';
}

/** The feature's own framework, else the first one among the features it requires (undefined: any). */
export function featureFramework(feature: FeatureDef): Framework | undefined {
	return (
		feature.framework ??
		requiredFeatures(feature)
			.map((id) => featureFramework(features.get(id)))
			.find(Boolean)
	);
}

function roleOf(chip: ChipConfig, flashOrder: number): RoleDef {
	return {
		id: chip.id,
		name: chip.name,
		framework: chipFramework(chip),
		features: chipFeatures(chip).map((f) => f.id),
		flashOrder
	};
}

function chipRole(project: ProjectConfig, chip: ChipConfig): RoleDef {
	return roleOf(
		chip,
		(chipFeatures(chip).some((f) => f.flashFirst) ? 0 : 100) +
			Math.max(project.chips.indexOf(chip), 0)
	);
}

function getChip(project: ProjectConfig, chipId: string): ChipConfig {
	const chip = project.chips.find((c) => c.id === chipId);
	if (!chip) throw new Error(`Unknown board '${chipId}'`);
	return chip;
}

/** Can this feature be added to the chip (board, framework and duplicates)? */
export function canAddFeature(
	chip: ChipConfig,
	feature: FeatureDef,
	project?: ProjectConfig
): string | undefined {
	if (feature.always || feature.id in chip.features) return 'already added';
	const board = chipBoard(chip);
	if (feature.chips && !feature.chips.includes(board.chip))
		return `needs ${feature.chips.join(', ')} (this board is ${board.chip})`;
	const framework = featureFramework(feature);
	const clash = chipFeatures(chip).find((f) => {
		const other = featureFramework(f);
		return framework && other && other !== framework;
	});
	if (clash) return `can't share a board with ${clash.name}`;
	if (project && feature.unavailable)
		return feature.unavailable(makeContext(project, chip, feature));
	return undefined;
}

const requirements = new Map<string, string[]>();

/**
 * Features that must be on the same chip as this one: those bringing the services its `activate`
 * `use`s (not the ones it `find`s, or `use`s only when another feature is there). Found by
 * activating it alone, with its defaults.
 */
export function requiredFeatures(feature: FeatureDef): string[] {
	let required = requirements.get(feature.id);
	if (required) return required;
	// None while it activates: its context lists the chip's features in hook order, which asks again.
	requirements.set(feature.id, []);
	const used = new Set<string>();
	const board = boards.get(DEFAULT_BOARD);
	const chip: ChipConfig = {
		id: 'chip',
		name: '',
		board: board.id,
		features: { [feature.id]: featureDefaults(feature, board) }
	};
	const project: ProjectConfig = { version: 2, name: '', chips: [chip] };
	const services = new Services(features.all().map((f) => f.id));
	feature.activate?.({
		...makeContext(project, chip, feature, () => services),
		use: (key) => {
			if (key.feature) used.add(key.feature);
			return scoped(services.get(key), feature);
		},
		find: () => undefined
	});
	required = [...used].filter((id) => id !== feature.id);
	requirements.set(feature.id, required);
	return required;
}

/** Add a feature with its default config (and the features it requires). */
export function addFeature(chip: ChipConfig, featureId: string) {
	const feature = features.get(featureId);
	const board = chipBoard(chip);
	for (const req of requiredFeatures(feature)) if (!(req in chip.features)) addFeature(chip, req);
	if (featureId in chip.features) return;
	chip.features[featureId] = featureDefaults(feature, board);
}

/** Features on the chip that need this one (it can't be removed while they are there). */
export function requiredBy(chip: ChipConfig, featureId: string): FeatureDef[] {
	return chipFeatures(chip).filter((f) => requiredFeatures(f).includes(featureId));
}

/** Features that have to go when the chip switches to this board: unsupported ones and their dependents. */
export function featuresDroppedBy(chip: ChipConfig, board: BoardDef): FeatureDef[] {
	const enabled = chipFeatures(chip);
	const drop = enabled.filter((f) => !f.always && f.chips && !f.chips.includes(board.chip));
	for (let more = true; more;) {
		more = false;
		for (const f of enabled) {
			if (!drop.includes(f) && requiredFeatures(f).some((r) => drop.some((d) => d.id === r))) {
				drop.push(f);
				more = true;
			}
		}
	}
	return drop;
}

/** Switch the chip to another board: drops `featuresDroppedBy` and resets the GPIOs to its defaults. */
export function changeBoard(chip: ChipConfig, board: BoardDef) {
	for (const feature of featuresDroppedBy(chip, board)) delete chip.features[feature.id];
	chip.board = board.id;
	for (const feature of chipFeatures(chip)) {
		const defaults = featureDefaults(feature, board);
		for (const pin of feature.pins ?? []) chip.features[feature.id][pin.key] = defaults[pin.key];
	}
}

function addAlwaysFeatures(chip: ChipConfig) {
	for (const feature of alwaysFeatures) addFeature(chip, feature.id);
}

/** A new chip with a free id and the features every chip has. */
export function newChip(project: ProjectConfig, board = DEFAULT_BOARD): ChipConfig {
	let n = project.chips.length + 1;
	while (project.chips.some((c) => c.id === `chip-${n}`)) n++;
	const chip: ChipConfig = { id: `chip-${n}`, name: `Board ${n}`, board, features: {} };
	addAlwaysFeatures(chip);
	return chip;
}

// ---------------------------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------------------------

/** A new device: from a template, or a single empty chip. */
export function defaultProject(templateId?: string, name?: string): ProjectConfig {
	const template = templateId ? templates.find(templateId) : undefined;
	return normalizeProject({
		version: 2,
		name: name ?? template?.name ?? 'My device',
		template: template?.id,
		chips: template
			? structuredClone(template.chips)
			: [{ id: 'chip-1', name: 'Main board', board: DEFAULT_BOARD, features: {} }]
	});
}

/**
 * Features of saved chips that were renamed or split up: the admin interface and the dashboard
 * became the two dashboards; timers were part of the dashboard, automations part of the Matter
 * controller (on the setup page).
 */
function migrateFeatures(raw: Record<string, FeatureConfig>): Record<string, FeatureConfig> {
	const out = { ...raw };
	if ('dashboard' in out) out.timers ??= {};
	if ('admin_ui' in out && 'matter_controller' in out) out.automations ??= {};
	for (const [from, to] of [
		['admin_ui', 'admin_dashboard'],
		['dashboard', 'user_dashboard']
	]) {
		if (!(from in out)) continue;
		out[to] ??= out[from];
		delete out[from];
	}
	return out;
}

/** Fill in defaults, coerce types and drop unknown keys. Safe on untrusted input. */
export function normalizeProject(raw: unknown): ProjectConfig {
	const input = (raw ?? {}) as Partial<ProjectConfig>;

	const template = input.template ? templates.find(String(input.template)) : undefined;
	const project: ProjectConfig = {
		version: 2,
		name:
			String(input.name ?? template?.name ?? '')
				.trim()
				.slice(0, 48) || 'My device',
		...(template ? { template: template.id } : {}),
		chips: []
	};
	const rawChips = Array.isArray(input.chips) ? input.chips.slice(0, MAX_CHIPS) : [];
	for (const rawChip of rawChips) {
		const fallback = newChip(project);
		let id = String(rawChip?.id ?? '');
		if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(id) || project.chips.some((c) => c.id === id)) {
			id = fallback.id;
		}
		const board = boards.has(String(rawChip?.board)) ? String(rawChip.board) : DEFAULT_BOARD;
		const chip: ChipConfig = {
			id,
			name: String(rawChip?.name ?? '').slice(0, 32) || fallback.name,
			board,
			features: {}
		};
		const rawFeatures = migrateFeatures((rawChip?.features ?? {}) as Record<string, FeatureConfig>);
		for (const featureId of Object.keys(rawFeatures)) {
			if (features.has(featureId)) addFeature(chip, featureId);
		}
		addAlwaysFeatures(chip);
		const boardDef = chipBoard(chip);
		for (const feature of chipFeatures(chip)) {
			const values = rawFeatures[feature.id] ?? {};
			chip.features[feature.id] = Object.fromEntries(
				Object.entries(featureDefaults(feature, boardDef)).map(([key, fallback]) => [
					key,
					coerce(fallback, values[key])
				])
			);
		}
		project.chips.push(chip);
	}
	if (project.chips.length === 0) project.chips.push(newChip(project));
	return project;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

export interface Issue {
	/** Chip id ('' for device-wide issues). */
	role: string;
	feature?: string;
	field?: string;
	message: string;
}

export function validateProject(project: ProjectConfig): Issue[] {
	const issues: Issue[] = [];

	for (const chip of project.chips) {
		const board = chipBoard(chip);
		const enabled = chipFeatures(chip);
		const usedPins = new Map<number, string>();
		let services: Services | undefined;
		const activated = () => (services ??= activateChip(project, chip));
		if (!enabled.some((f) => !f.always)) {
			issues.push({ role: chip.id, message: `${chip.name} has no features yet.` });
		}
		const frameworks = enabled.filter((f) => featureFramework(f));
		const mixed = frameworks.find((f) => featureFramework(f) !== featureFramework(frameworks[0]));
		if (mixed) {
			issues.push({
				role: chip.id,
				feature: mixed.id,
				message: `${mixed.name} can't run on the same board as ${frameworks[0].name}.`
			});
		}
		for (const feature of enabled) {
			if (feature.chips && !feature.chips.includes(board.chip)) {
				issues.push({
					role: chip.id,
					feature: feature.id,
					message: `${feature.name} does not support ${board.chip}.`
				});
			}
			for (const req of requiredFeatures(feature)) {
				if (!enabled.some((f) => f.id === req)) {
					issues.push({
						role: chip.id,
						feature: feature.id,
						message: `${feature.name} requires ${features.find(req)?.name ?? req}.`
					});
				}
			}
			const cfg = chip.features[feature.id] ?? {};
			for (const { key, label, optional } of feature.pins ?? []) {
				const pin = Number(cfg[key]);
				const at = { role: chip.id, feature: feature.id, field: key };
				if (optional && pin === -1) continue;
				// The BOOT button isn't always on the header but always usable as an input.
				if (pin !== board.bootButtonGpio && !boardGpios(board).some((p) => p.gpio === pin)) {
					issues.push({
						...at,
						message: `${label}: GPIO${pin} is not available on ${board.name}.`
					});
					continue;
				}
				const owner = `${feature.name} – ${label}`;
				if (usedPins.has(pin)) {
					issues.push({
						...at,
						message: `GPIO${pin} is used twice (${usedPins.get(pin)} and ${owner}).`
					});
				}
				usedPins.set(pin, owner);
			}
			for (const issue of feature.validate?.(makeContext(project, chip, feature, activated)) ??
				[]) {
				issues.push({
					role: chip.id,
					feature: feature.id,
					...(typeof issue === 'string' ? { message: issue } : issue)
				});
			}
		}
	}
	return issues;
}

// ---------------------------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------------------------

/**
 * The chip's services, with what its features registered: each feature activated in hook order
 * (`FeatureDef.activate`). `reached`: told each feature of the chip one `use`s, `find`s or `has`.
 */
function activateChip(
	project: ProjectConfig,
	chip: ChipConfig,
	reached?: (feature: FeatureDef, other: string) => void
): Services {
	const enabled = chipFeatures(chip);
	const ids = new Set(enabled.map((f) => f.id));
	const services = new Services(ids);
	for (const feature of enabled) {
		const reach = (other?: string) => {
			if (reached && other && other !== feature.id && ids.has(other)) reached(feature, other);
		};
		const context = makeContext(project, chip, feature, () => services);
		feature.activate?.({
			...context,
			use: (key) => {
				reach(key.feature);
				return scoped(services.get(key), feature);
			},
			find: (key) => {
				reach(key.feature);
				const service = services.find(key);
				return service === undefined ? undefined : scoped(service, feature);
			},
			has: (id, roleId = chip.id) => {
				if (roleId === chip.id) reach(id);
				return context.has(id, roleId);
			}
		});
	}
	return services;
}

/**
 * Per chip id: the features of the chip each one works with when they are there, without
 * requiring them (`requiredFeatures`): what its `activate` `find`s, checks with `has` or `use`s
 * only then.
 */
export function softDependencies(project: ProjectConfig): Map<string, Map<string, Set<string>>> {
	project = normalizeProject(project);
	const result = new Map<string, Map<string, Set<string>>>();
	for (const chip of project.chips) {
		const soft = new Map<string, Set<string>>();
		activateChip(project, chip, (feature, other) => {
			if (requiredFeatures(feature).includes(other)) return;
			soft.set(feature.id, (soft.get(feature.id) ?? new Set()).add(other));
		});
		result.set(chip.id, soft);
	}
	return result;
}

/** The services of a chip of the device, with what its features registered. */
export function chipServices(project: ProjectConfig, chipId: string): Services {
	project = normalizeProject(project);
	return activateChip(project, getChip(project, chipId));
}

/**
 * The services of a chip with just these features, all with their defaults: e.g. a built
 * firmware's, for what doesn't depend on the settings (its flash methods).
 */
export function featureServices(featureIds: string[], board = DEFAULT_BOARD): Services {
	const config = Object.fromEntries(featureIds.map((id) => [id, {}]));
	return chipServices(
		{ version: 2, name: '', chips: [{ id: 'chip', name: '', board, features: config }] },
		'chip'
	);
}

/**
 * The pages of the web interface the chip's features registered (`devicePages`), in menu order
 * (by path).
 */
function chipPages(services: Services): (DevicePage & { dir: string })[] {
	return (services.find(devicePages)?.entries() ?? [])
		.map(({ feature, item }) => ({ ...item, dir: feature.dir }))
		.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The REST API routes a chip's features registered (`webServer`), in hook order, with the feature's name. */
export function apiRoutes(
	project: ProjectConfig,
	chipId: string
): (DeviceApiRoute & { feature: string })[] {
	return documentedRoutes(chipServices(project, chipId));
}

/** `services`: the chip's, activated on first use (not while activating). */
function makeContext(
	project: ProjectConfig,
	chip: ChipConfig,
	feature: FeatureDef,
	services?: () => Services,
	role = chipRole(project, chip)
): GenerateContext {
	const chipById = (id: string) => project.chips.find((c) => c.id === id) ?? chip;
	let activated: Services | undefined;
	const servicesOf = services ?? (() => (activated ??= activateChip(project, chip)));
	return {
		project,
		role,
		board: chipBoard(chip),
		config: chip.features[feature.id] ?? {},
		features: chipFeatures(chip),
		pages: () => chipPages(servicesOf()),
		featureConfig: (id, roleId = chip.id) => chipById(roleId).features[id],
		boardFor: (roleId) => chipBoard(chipById(roleId)),
		has: (id, roleId = chip.id) => chipFeatures(chipById(roleId)).some((f) => f.id === id),
		chipsWith: (id) => project.chips.filter((c) => id in c.features).map((c) => c.id),
		chipName: (roleId) => chipById(roleId).name
	};
}

/** Hash of everything that influences the firmware. Identical configs produce identical builds. */
export function projectHash(project: ProjectConfig): string {
	return hash(stableStringify({ project, ESP_MATTER_VERSION, IDF_VERSION }));
}

/**
 * Identifies what a build compiles: the config plus every generated file of every role, so a
 * changed firmware source rebuilds even when the config is the same (unlike `projectHash`).
 */
export function generatedHash(project: ProjectConfig): string {
	project = normalizeProject(project);
	const roles = generateProject(project).map((r) => ({ role: r.role.id, files: r.files }));
	return hash(stableStringify({ config: projectHash(project), roles }));
}

/** The first item of each key, in order. */
function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
	const seen = new Set<string>();
	return items.filter((item) => !seen.has(key(item)) && !!seen.add(key(item)));
}

/** Wires between the chips, registered by their features (`wires`, shared wires once). */
export function wiring(project: ProjectConfig): Wire[] {
	const end = (e: Wire['from']) => `${e.role}/${e.pin}`;
	return uniqueBy(
		project.chips.flatMap((chip) => activateChip(project, chip).get(wires).items()),
		(w) => [end(w.from), end(w.to)].sort().join('|')
	);
}

/** External parts the wires go through (`parts`, each id once), registered by the features. */
export function externalParts(project: ProjectConfig): PartDef[] {
	return uniqueBy(
		project.chips.flatMap((chip) => activateChip(project, chip).get(parts).items()),
		(p) => p.id
	);
}

export function templateName(project: ProjectConfig): string {
	return (project.template && templates.find(project.template)?.name) || 'Custom device';
}

function sdkconfigDefaults(
	target: string,
	values: Record<string, SdkconfigValue>,
	header: string
): string {
	const lines = [header, `CONFIG_IDF_TARGET=${JSON.stringify(target)}`, ''];
	for (const [key, value] of Object.entries(values)) lines.push(sdkconfigLine(key, value));
	return lines.join('\n') + '\n';
}

function espmConfigH(defines: Record<string, SdkconfigValue>): string {
	return [
		'// Generated by vibes-espmatter – project configuration. Do not edit, regenerate instead.',
		'#pragma once',
		'',
		...Object.entries(defines).map(([k, v]) => cDefine(k, v)),
		''
	].join('\n');
}

/** Each feature's snippets go into their own `{ }` scope so local names can't clash. */
function block(snippets: { feature: string; code: string }[], spaces = 4): string {
	const groups: { feature: string; code: string[] }[] = [];
	for (const s of snippets) {
		const last = groups.at(-1);
		if (last?.feature === s.feature) last.code.push(s.code);
		else groups.push({ feature: s.feature, code: [s.code] });
	}
	return groups
		.map(({ feature, code }) => indent(`{ // ${feature}\n${indent(code.join('\n'))}\n}`, spaces))
		.join('\n');
}

const generatedBy = (project: ProjectConfig, role: RoleDef) =>
	`Generated by vibes-espmatter – ${project.name} (${role.name})`;

/** Start of `app_main`: NVS, erased when it's full or from an older IDF. */
const NVS_INIT = `    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);`;

function appMainMatter(c: Collected, project: ProjectConfig, role: RoleDef): string {
	return `// ${generatedBy(project, role)}. Do not edit, regenerate instead.
#include <esp_err.h>
#include <esp_log.h>
#include <esp_netif.h>
#include <nvs_flash.h>

#include <esp_matter.h>

#include "espm_config.h"
${c.includes.join('\n')}

static const char *TAG = "app_main";

${c.globals.join('\n\n')}

static void on_ip_ready()
{
${block(c.onIp)}
}

static void app_event_cb(const ChipDeviceEvent *event, intptr_t arg)
{
    if (event->Type == chip::DeviceLayer::DeviceEventType::kESPSystemEvent &&
        event->Platform.ESPSystemEvent.Base == IP_EVENT &&
        event->Platform.ESPSystemEvent.Id == IP_EVENT_STA_GOT_IP) {
        static bool s_ip_ready = false;
        if (!s_ip_ready) {
            s_ip_ready = true;
            on_ip_ready();
        }
    }
}

extern "C" void app_main()
{
${NVS_INIT}
    ESP_LOGI(TAG, "%s – %s – build %s", MESP_DEVICE_NAME, MESP_DEVICE_TYPE, MESP_BUILD_ID);

${block(c.preStart)}

    err = esp_matter::start(app_event_cb);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start Matter: %s", esp_err_to_name(err));
        return;
    }

${block(c.postStart)}

${block(c.started)}
}
`;
}

function appMainIdf(c: Collected, project: ProjectConfig, role: RoleDef): string {
	return `// ${generatedBy(project, role)}. Do not edit, regenerate instead.
#include "esp_err.h"
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"

#include "espm_config.h"
${c.includes.join('\n')}

${c.globals.join('\n\n')}

void app_main(void)
{
${NVS_INIT}
    ESP_ERROR_CHECK(esp_event_loop_create_default());

${block(c.preStart)}
${block(c.postStart)}
${block(c.started)}
}
`;
}

/** Top-level CMake flags esp-matter needs. */
const MATTER_CMAKE_OPTIONS = `
idf_build_set_property(CXX_COMPILE_OPTIONS "-std=gnu++17;-Os;-DCHIP_HAVE_CONFIG_H;-Wno-overloaded-virtual" APPEND)
idf_build_set_property(C_COMPILE_OPTIONS "-Os" APPEND)
# For RISC-V chips project_include.cmake sets -Wno-format, but does not clear flags that depend on -Wformat
idf_build_set_property(COMPILE_OPTIONS "-Wno-format-nonliteral;-Wno-format-security;-Wformat=0" APPEND)
`;

interface Collected {
	sdkconfig: Record<string, SdkconfigValue>;
	defines: Record<string, SdkconfigValue>;
	compileOptions: string[];
	linkOptions: string[];
	dependencies: NonNullable<Contribution['dependencies']>;
	sources: Record<string, string>;
	rootFiles: Record<string, string>;
	includes: string[];
	globals: string[];
	preStart: { feature: string; code: string }[];
	postStart: { feature: string; code: string }[];
	started: { feature: string; code: string }[];
	onIp: { feature: string; code: string }[];
	notes: string[];
}

function pushUnique(list: string[], items: string[] = []) {
	for (const item of items) if (!list.includes(item)) list.push(item);
}

export function generateRole(project: ProjectConfig, roleId: string): GeneratedProject {
	project = normalizeProject(project);
	const chip = getChip(project, roleId);
	const role = chipRole(project, chip);
	const board = chipBoard(chip);
	const buildId = projectHash(project);

	const c: Collected = {
		sdkconfig: {},
		defines: {
			MESP_DEVICE_NAME: project.name,
			MESP_DEVICE_TYPE: project.template ?? 'custom',
			MESP_ROLE: role.id,
			MESP_BUILD_ID: buildId,
			MESP_HOSTNAME: slugify(project.name),
			MESP_WEB_PORT: 80,
			MESP_WEB_AUTH_USER: '',
			MESP_WEB_AUTH_PASSWORD: '',
			MESP_WEB_AUTH_SEED: 0,
			MESP_OTA: false
		},
		compileOptions: [],
		linkOptions: [],
		dependencies: {},
		sources: {},
		rootFiles: {},
		includes: [],
		globals: [],
		preStart: [],
		postStart: [],
		started: [],
		onIp: [],
		notes: []
	};

	const services = activateChip(project, chip);
	for (const { feature, item: generate } of services.get(firmware).entries()) {
		const out = generate();
		Object.assign(c.sdkconfig, out.sdkconfig);
		Object.assign(c.defines, out.defines);
		Object.assign(c.dependencies, out.dependencies);
		Object.assign(c.sources, out.sources);
		Object.assign(c.rootFiles, out.rootFiles);
		pushUnique(c.compileOptions, out.compileOptions);
		pushUnique(c.linkOptions, out.linkOptions);
		pushUnique(c.includes, out.hooks?.includes);
		c.globals.push(...(out.hooks?.globals ?? []));
		const tag = (code: string) => ({ feature: feature.name, code });
		c.preStart.push(...(out.hooks?.preStart ?? []).map(tag));
		c.postStart.push(...(out.hooks?.postStart ?? []).map(tag));
		c.started.push(...(out.hooks?.started ?? []).map(tag));
		c.onIp.push(...(out.hooks?.onIp ?? []).map(tag));
		c.notes.push(...(out.notes ?? []));
	}
	const chipPanels = (services.find(devicePanels)?.entries() ?? []).map(({ feature, item }) => ({
		...item,
		dir: feature.dir
	}));

	const files: Record<string, string> = {};
	const slug = `espm_${role.id}`;
	const header = `# ${generatedBy(project, role)}, board ${board.name}`;
	files['sdkconfig.defaults'] = sdkconfigDefaults(board.chip, c.sdkconfig, header);
	Object.assign(files, c.rootFiles);

	const sources = Object.keys(c.sources).filter((f) => /\.(c|cpp)$/.test(f));
	const pages = chipPages(services);
	const ldfragments = 'linker.lf' in c.sources;
	const embeds = pages.map((p) => `${p.id}.html.gz`);

	const matter = role.framework === 'esp-matter';
	const appMain = matter ? 'app_main.cpp' : 'app_main.c';
	files['CMakeLists.txt'] = `${header}
cmake_minimum_required(VERSION 3.16)

set(PROJECT_VER "1.0.0")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

project(${slug})
${matter ? MATTER_CMAKE_OPTIONS : ''}${c.compileOptions.length ? `idf_build_set_property(COMPILE_OPTIONS "${c.compileOptions.join(';')}" APPEND)\n` : ''}`;
	files[`main/${appMain}`] = matter
		? appMainMatter(c, project, role)
		: appMainIdf(c, project, role);
	if (matter) c.dependencies['espressif/esp_matter'] = { version: ESP_MATTER_VERSION };

	const mainSrcs = [appMain, ...sources];
	files['main/CMakeLists.txt'] = `${header}
idf_component_register(SRCS ${mainSrcs.map((s) => `"${s}"`).join(' ')}
                       INCLUDE_DIRS "."${embeds.length ? `\n                       EMBED_FILES ${embeds.map((f) => `"${f}"`).join(' ')}` : ''}${ldfragments ? '\n                       LDFRAGMENTS "linker.lf"' : ''})
${matter ? 'target_compile_options(${COMPONENT_LIB} PRIVATE "-DCHIP_HAVE_CONFIG_H")\n' : ''}${c.linkOptions.map((o) => `target_link_libraries(\${COMPONENT_LIB} INTERFACE "${o}")\n`).join('')}`;

	if (Object.keys(c.dependencies).length) {
		const deps = Object.entries(c.dependencies)
			.map(([name, d]) => {
				const lines = [`  ${name}:`];
				if (d.version) lines.push(`    version: "${d.version}"`);
				if (d.path) lines.push(`    path: "${d.path}"`);
				if (d.rules?.length)
					lines.push('    rules:', ...d.rules.map((r) => `      - if: "${r.if}"`));
				return lines.join('\n');
			})
			.join('\n');
		files['main/idf_component.yml'] = `${header}\ndependencies:\n${deps}\n`;
	}

	for (const [name, content] of Object.entries(c.sources)) files[`main/${name}`] = content;
	files['main/espm_config.h'] = espmConfigH(c.defines);

	// Panels go to the page they name, or to the page that takes the others.
	const collector = pages.find((p) => p.collectsPanels)?.id;
	const links = pages.map(({ id, path, title, icon, access }) => ({
		id,
		path,
		title,
		icon,
		access
	}));
	const ui: DeviceUiSpec[] = pages.map((page) => ({
		page: page.id,
		layout: `features/${page.dir}/device-ui/${page.layout}`,
		path: page.path,
		appName: page.appName,
		device: { name: project.name, typeName: templateName(project), roleName: role.name },
		pages: links,
		panels: chipPanels
			.filter((p) => (p.page ?? collector) === page.id)
			.map((p) => ({
				id: p.id,
				title: p.title,
				props: p.props,
				area: p.area ?? 'main',
				section: p.section ?? 'system',
				module: `features/${p.dir}/device-ui/${p.file}`
			}))
	}));

	files['README.md'] = readme(project, role, board, ui.length > 0);

	return {
		role,
		board,
		target: board.chip,
		files,
		ui,
		notes: c.notes
	};
}

/** Chips in flash order. */
export function projectRoles(project: ProjectConfig): RoleDef[] {
	return project.chips
		.map((chip) => chipRole(project, chip))
		.sort((a, b) => a.flashOrder - b.flashOrder);
}

export function generateProject(project: ProjectConfig): GeneratedProject[] {
	project = normalizeProject(project);
	return projectRoles(project).map((r) => generateRole(project, r.id));
}

function readme(project: ProjectConfig, role: RoleDef, board: BoardDef, ui: boolean): string {
	return `# ${project.name} – ${role.name}

Generated by vibes-espmatter (${templateName(project)}) for **${board.name}** (\`${board.chip}\`).

Features: ${role.features.map((id) => features.get(id).name).join(', ')}.

## Build manually

Requires ESP-IDF ${IDF_VERSION}${role.framework === 'esp-matter' ? ` (esp-matter ${ESP_MATTER_VERSION} is downloaded from the component registry)` : ''}.

\`\`\`sh
. $IDF_PATH/export.sh
idf.py build
idf.py -p /dev/ttyACM0 flash monitor
\`\`\`
${ui ? '\n`main/*.html.gz` (the pages of the device web interface) are compiled by the vibes-espmatter build server from the Svelte files in `src/lib/device`. They are not part of this export – take them from a server build.\n' : ''}`;
}
