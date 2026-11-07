/**
 * Turns an `Assembly` into one ESP-IDF project per board slot: CMake files, `sdkconfig.defaults`,
 * the partition table, a generated `app_main` and `espm_config.h`, plus the plugins' sources.
 *
 * Source contents are passed in (`readSource`), so this stays isomorphic – the server reads them
 * from `plugins/**\/firmware/`.
 */
import { CExpr, cString, type DefineValue, type InitPhase, type SettingValue } from '#sdk';
import type { Assembly, SlotFirmware, SourceRef } from './assemble';
import { CFG_PARTITION } from './cfg';
import { ESP_MATTER_VERSION } from './matter-version';
import { MAIN } from './model';

export { ESP_MATTER_VERSION };
export const IDF_VERSION = 'v5.4.2';
export const UI_FILE = 'ui.html.gz';

export interface GeneratedSlot {
	slot: string;
	name: string;
	board: string;
	target: string;
	framework: 'esp-idf' | 'esp-matter';
	flashFirst: boolean;
	files: Record<string, string>;
	/** The device web interface must be compiled into `main/ui.html.gz`. */
	needsUi: boolean;
	/** Where the device configuration goes (Matter slots). */
	configPartition?: { offset: number; size: number };
	/** The main board installs this slot's updates over a wire (`SlotDef.flashOverWire`). */
	wired: boolean;
}

const PHASES: InitPhase[] = ['early', 'matter', 'started', 'late'];

const BOOTLOADER_OFFSET: Record<string, number> = {
	esp32: 0x1000,
	esp32s2: 0x1000,
	esp32p4: 0x2000,
	esp32c5: 0x2000
};
export const bootloaderOffset = (target: string) => BOOTLOADER_OFFSET[target] ?? 0;

function sdkLine(key: string, value: SettingValue): string {
	if (typeof value === 'boolean') return value ? `${key}=y` : `# ${key} is not set`;
	if (typeof value === 'number') return `${key}=${value}`;
	return `${key}=${JSON.stringify(value)}`;
}

function cDefine(name: string, value: DefineValue): string {
	if (value instanceof CExpr) return `#define ${name} (${value.code})`;
	if (typeof value === 'boolean') return `#define ${name} ${value ? 1 : 0}`;
	if (typeof value === 'number') return `#define ${name} ${value}`;
	return `#define ${name} ${cString(value)}`;
}

const indent = (code: string, n = 4) =>
	code
		.split('\n')
		.map((l) => (l.trim() ? ' '.repeat(n) + l : l))
		.join('\n');

/** Each block's snippets in their own scope, so local names can't clash. */
function scoped(snippets: { code: string; by: string }[]): string {
	const groups: { by: string; code: string[] }[] = [];
	for (const s of snippets) {
		const last = groups.at(-1);
		if (last?.by === s.by) last.code.push(s.code);
		else groups.push({ by: s.by, code: [s.code] });
	}
	return groups.map((g) => indent(`{ // ${g.by}\n${indent(g.code.join('\n'))}\n}`)).join('\n');
}

const hex = (n: number) => '0x' + n.toString(16);

/** Partitions until here are data; the apps start at the first 64 KB boundary after. */
const APP_START = 0x20000;
/** Data partitions up to this size fit into the space before the apps. */
const SMALL_DATA = 0x8000;

type PartitionRow = [name: string, type: string, sub: string, offset: number, size: number];

export function partitionLayout(fw: SlotFirmware): PartitionRow[] {
	const flash = fw.slot.board.flashMB * 1024 * 1024;
	const ota = fw.matter;
	const rows: PartitionRow[] = [];
	let offset = 0x9000;
	const add = (name: string, type: string, sub: string, size: number) => {
		rows.push([name, type, sub, offset, size]);
		offset += size;
	};
	add('nvs', 'data', 'nvs', ota ? 0xc000 : 0x6000);
	if (ota) add('otadata', 'data', 'ota', 0x2000);
	add('phy_init', 'data', 'phy', 0x1000);
	const size = (kb: number, align: number) => Math.ceil((kb * 1024) / align) * align;
	// Small data partitions (the device configuration) go before the apps, as long as they fit.
	const fitting: typeof fw.partitions = [];
	for (const p of fw.partitions) {
		const bytes = size(p.sizeKB, 0x1000);
		if (p.type !== 'data' || bytes > SMALL_DATA || offset + bytes > APP_START) continue;
		add(p.name, p.type, p.subtype, bytes);
		fitting.push(p);
	}
	const rest = fw.partitions.filter((p) => !fitting.includes(p));
	const extras = rest.reduce((n, p) => n + size(p.sizeKB, 0x10000), 0);
	offset = APP_START;
	const available = flash - offset - extras;
	if (ota) {
		const slot = Math.floor(available / 2 / 0x10000) * 0x10000;
		add('ota_0', 'app', 'ota_0', slot);
		add('ota_1', 'app', 'ota_1', slot);
	} else {
		add('factory', 'app', 'factory', Math.floor(available / 0x10000) * 0x10000);
	}
	for (const p of rest) add(p.name, p.type, p.subtype, size(p.sizeKB, 0x10000));
	return rows;
}

export function partitionTable(fw: SlotFirmware): string {
	return (
		'# Name, Type, SubType, Offset, Size, Flags\n' +
		partitionLayout(fw)
			.map(([n, t, s, o, size]) => `${n}, ${t}, ${s}, ${hex(o)}, ${hex(size)},`)
			.join('\n') +
		'\n'
	);
}

const hasPsram = (slot: SlotFirmware['slot']) =>
	slot.board.psram !== 'none' && slot.chip.id !== 'esp32p4';

/**
 * Static data (.bss) of our own code and esp-matter/CHIP goes to PSRAM. None of it is touched from
 * an ISR or with the flash cache off. (OpenThread's: espm_otbr.lf.)
 */
function psramFragment(header: string, matter: boolean): string {
	const map = (name: string, archive: string) => `
[mapping:${name}]
archive: ${archive}
entries:
  if SPIRAM_ALLOW_BSS_SEG_EXTERNAL_MEMORY = y:
    * (extram_bss)
  else:
    * (default)
`;
	return `# ${header}\n${map('espm_main', 'libmain.a')}${matter ? map('espm_esp_matter', 'libespressif__esp_matter.a') : ''}`;
}

function sdkconfig(fw: SlotFirmware, header: string, version: number): string {
	const { board, chip } = fw.slot;
	const values: Record<string, SettingValue> = {
		[`CONFIG_ESPTOOLPY_FLASHSIZE_${board.flashMB}MB`]: true,
		CONFIG_PARTITION_TABLE_CUSTOM: true,
		CONFIG_PARTITION_TABLE_CUSTOM_FILENAME: 'partitions.csv',
		CONFIG_COMPILER_OPTIMIZATION_SIZE: true
	};
	if (board.usb === 'usb-serial-jtag') values.CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG = true;
	if (hasPsram(fw.slot)) {
		values.CONFIG_SPIRAM = true;
		values[board.psram === 'octal' ? 'CONFIG_SPIRAM_MODE_OCT' : 'CONFIG_SPIRAM_MODE_QUAD'] = true;
		values.CONFIG_SPIRAM_USE_MALLOC = true;
		// Internal RAM runs out first (a hub with Matter controller + Thread border router had 12 KB
		// left, too little for the OpenThread task): only tiny blocks there, everything else into
		// PSRAM, and static data too (espm_psram.lf). The previous generation's hub ran fine so.
		values.CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL = 512;
		values.CONFIG_SPIRAM_MALLOC_RESERVE_INTERNAL = 16384;
		values.CONFIG_SPIRAM_ALLOW_BSS_SEG_EXTERNAL_MEMORY = true;
		values.CONFIG_SPIRAM_TRY_ALLOCATE_WIFI_LWIP = true;
		values.CONFIG_MBEDTLS_EXTERNAL_MEM_ALLOC = true;
	}
	if (fw.matter) {
		Object.assign(values, {
			CONFIG_DEVICE_SOFTWARE_VERSION_NUMBER: version,
			CONFIG_DEVICE_SOFTWARE_VERSION: String(version),
			CONFIG_DEVICE_VENDOR_ID: Number(fw.defines.ESPM_MATTER_VENDOR_ID ?? 0xfff1),
			CONFIG_DEVICE_PRODUCT_ID: Number(fw.defines.ESPM_MATTER_PRODUCT_ID ?? 0x8000),
			CONFIG_BT_NIMBLE_HCI_EVT_HI_BUF_COUNT: 70,
			CONFIG_BT_NIMBLE_EXT_ADV: false,
			CONFIG_LWIP_IPV6_AUTOCONFIG: true,
			CONFIG_MBEDTLS_HKDF_C: true,
			CONFIG_ESP_MAIN_TASK_STACK_SIZE: 6144,
			CONFIG_ESP_SYSTEM_EVENT_TASK_STACK_SIZE: 4096,
			CONFIG_FREERTOS_HZ: 1000
		});
		if (board.psram !== 'none') {
			values.CONFIG_BT_NIMBLE_MEM_ALLOC_MODE_EXTERNAL = true;
			values.CONFIG_ESP_MATTER_MEM_ALLOC_MODE_EXTERNAL = true;
		}
	}
	Object.assign(values, fw.sdkconfig);
	return [
		header,
		`CONFIG_IDF_TARGET=${JSON.stringify(chip.id)}`,
		'',
		...Object.entries(values).map(([k, v]) => sdkLine(k, v)),
		''
	].join('\n');
}

function appMainMatter(fw: SlotFirmware, header: string): string {
	const by = (phase: InitPhase) => fw.init.filter((i) => i.phase === phase);
	return `// ${header}
#include <string.h>
#include <esp_err.h>
#include <esp_log.h>
#include <nvs_flash.h>
#include <esp_matter.h>

#include "espm_config.h"
${fw.includes.map((h) => `#include ${h}`).join('\n')}

static const char *TAG = "app_main";

/** Called once by espm_matter.cpp when the device got an IP address. */
void espm_app_on_network()
{
${scoped(by('network'))}
}

extern "C" void app_main()
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);
    ESP_LOGI(TAG, "%s (%s) firmware %d, build %s", ESPM_DEVICE_NAME, ESPM_SLOT, ESPM_FW_VERSION, ESPM_BUILD_ID);

${scoped(by('early'))}

    // Matter data model: the root node, then every endpoint.
${scoped(by('matter'))}

    err = esp_matter::start(espm_matter_event);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Matter failed to start: %s", esp_err_to_name(err));
        return;
    }

${scoped(by('started'))}

${scoped(by('late'))}
}
`;
}

function appMainIdf(fw: SlotFirmware, header: string): string {
	const by = (phase: InitPhase) => fw.init.filter((i) => i.phase === phase);
	return `// ${header}
#include "esp_err.h"
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"

#include "espm_config.h"
${fw.includes.map((h) => `#include ${h}`).join('\n')}

void app_main(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);
    ESP_ERROR_CHECK(esp_event_loop_create_default());

${PHASES.filter((p) => p !== 'matter')
	.map((p) => scoped(by(p)))
	.join('\n')}
}
`;
}

/**
 * The slots the main board flashes over a wire (`SlotDef.flashOverWire`): how to reach each one and
 * where its app goes. The images themselves come from the app at update time.
 */
function slotTable(header: string, a: Assembly): string | undefined {
	const slots = a.firmware.filter((fw) => fw.slot.wired && fw.slot.chip.rom);
	if (!slots.length) return undefined;
	const table = slots.map((fw) => {
		const pins = fw.slot.wired!;
		const rom = fw.slot.chip.rom!;
		const app = partitionLayout(fw).find((p) => p[0] === 'factory' || p[0] === 'ota_0')!;
		return `    {
        .id = ${cString(fw.slot.id)},
        .name = ${cString(fw.slot.name)},
        .chip = ${cString(fw.slot.chip.id)},
        .tx = ${pins.hostTx},
        .rx = ${pins.hostRx},
        .trigger = ${pins.hostTrigger},
        .flash_size = ${hex(fw.slot.board.flashMB * 1024 * 1024)},
        .force_reg = ${hex(rom.forceDownload.reg)},
        .force_mask = ${hex(rom.forceDownload.mask)},
        .app_offset = ${hex(app[3])},
        .app_max = ${hex(app[4])},
    },`;
	});
	return `// ${header}
#include "espm_slotflash.h"

const espm_slot_t espm_slots[] = {
${table.join('\n')}
};
const int espm_slot_count = ${slots.length};
`;
}

export function generateSlot(
	fw: SlotFirmware,
	a: Assembly,
	readSource: (ref: SourceRef) => string,
	version = 1
): GeneratedSlot {
	const { slot } = fw;
	const config = a.resolved.config;
	const header = `Generated by espmatter studio – ${config.name} / ${slot.name} (${slot.board.name}). Do not edit, regenerate instead.`;
	const files: Record<string, string> = {};
	const needsUi = slot.id === MAIN && !!fw.defines.ESPM_HTTP && a.pages.length > 0;

	files['sdkconfig.defaults'] = sdkconfig(fw, `# ${header}`, version);
	files['partitions.csv'] = partitionTable(fw);
	const cfgRow = partitionLayout(fw).find((p) => p[0] === CFG_PARTITION);
	const cfg = cfgRow ? { offset: cfgRow[3], size: cfgRow[4] } : undefined;

	const appMain = fw.matter ? 'app_main.cpp' : 'app_main.c';
	files[`main/${appMain}`] = fw.matter ? appMainMatter(fw, header) : appMainIdf(fw, header);
	for (const ref of fw.sources) {
		const name = ref.file.split('/').pop()!;
		if (files[`main/${name}`] !== undefined)
			throw new Error(`Two plugins ship a file named ${name}`);
		files[`main/${name}`] = readSource(ref);
	}
	for (const [name, content] of Object.entries(fw.generated)) files[`main/${name}`] = content;
	const table = slot.id === MAIN ? slotTable(header, a) : undefined;
	if (table) files['main/espm_slots.c'] = table;
	const runtime = Object.values(fw.defines).some((v) => v instanceof CExpr);
	files['main/espm_config.h'] = [
		`// ${header}`,
		'#pragma once',
		'',
		// Values of the device (its configuration partition) are read at runtime.
		...(runtime ? ['#include "espm_cfg.h"', ''] : []),
		...Object.entries({ ...fw.defines, ESPM_UI: needsUi }).map(([k, v]) => cDefine(k, v)),
		''
	].join('\n');

	const srcs = [
		appMain,
		...Object.keys(files)
			.filter((f) => f.startsWith('main/') && /\.(c|cpp)$/.test(f) && !f.endsWith(appMain))
			.map((f) => f.slice(5))
	];
	if (hasPsram(slot)) files['main/espm_psram.lf'] = psramFragment(header, fw.matter);
	// Linker fragments (.lf): plugins' and espm_psram.lf.
	const ldfragments = Object.keys(files)
		.filter((f) => f.startsWith('main/') && f.endsWith('.lf'))
		.map((f) => f.slice(5));
	// WHOLE_ARCHIVE: routes register from static constructors (espm_system.cpp etc.) – nothing
	// references those objects, so a plain archive link would silently drop them.
	files['main/CMakeLists.txt'] = `# ${header}
idf_component_register(SRCS ${srcs.map((s) => `"${s}"`).join(' ')}
                       INCLUDE_DIRS "."
                       WHOLE_ARCHIVE${needsUi ? `\n                       EMBED_FILES "${UI_FILE}"` : ''}${
													ldfragments.length
														? `\n                       LDFRAGMENTS ${ldfragments.map((f) => `"${f}"`).join(' ')}`
														: ''
												})
${fw.matter ? 'target_compile_options(${COMPONENT_LIB} PRIVATE "-DCHIP_HAVE_CONFIG_H")\n' : ''}${
		fw.linkOptions.length
			? `target_link_options(\${COMPONENT_LIB} INTERFACE ${fw.linkOptions.map((o) => `"${o}"`).join(' ')})\n`
			: ''
	}`;

	const components = { ...fw.components };
	if (fw.matter) components['espressif/esp_matter'] = ESP_MATTER_VERSION;
	if (Object.keys(components).length)
		files['main/idf_component.yml'] = `# ${header}\ndependencies:\n${Object.entries(components)
			.map(([n, v]) => `  ${n}:\n    version: "${v}"`)
			.join('\n')}\n`;

	files['CMakeLists.txt'] = `# ${header}
cmake_minimum_required(VERSION 3.16)
set(PROJECT_VER "${version}")
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(espm_${slot.id})
${
	fw.matter
		? `idf_build_set_property(CXX_COMPILE_OPTIONS "-std=gnu++17;-Os;-DCHIP_HAVE_CONFIG_H;-Wno-overloaded-virtual" APPEND)
idf_build_set_property(C_COMPILE_OPTIONS "-Os" APPEND)
idf_build_set_property(COMPILE_OPTIONS "-Wno-format-nonliteral;-Wno-format-security;-Wformat=0" APPEND)
`
		: ''
}`;

	files['README.md'] = `# ${config.name} – ${slot.name}

Generated by espmatter studio for **${slot.board.name}** (\`${slot.chip.id}\`).

Contains: ${fw.blocks.join(', ')}.
${
	cfg
		? `
Device settings (identity, network, per-device values) are not compiled in: they live in the
\`${CFG_PARTITION}\` partition at ${hex(cfg.offset)}. Without it the firmware starts with empty
defaults – flash a device from the app, or download its \`config.bin\` there and write it with
\`esptool.py write_flash ${hex(cfg.offset)} config.bin\`.
`
		: ''
}
\`\`\`sh
. $IDF_PATH/export.sh   # ESP-IDF ${IDF_VERSION}
idf.py build
idf.py -p /dev/ttyACM0 flash monitor
\`\`\`
${needsUi ? `\n\`main/${UI_FILE}\` (the device web interface) is compiled by the app; builds started from the app include it.\n` : ''}`;

	return {
		slot: slot.id,
		name: slot.name,
		board: slot.board.id,
		target: slot.chip.id,
		framework: slot.framework,
		flashFirst: slot.flashFirst,
		files,
		needsUi,
		configPartition: cfg,
		wired: !!slot.wired
	};
}

export function generate(
	a: Assembly,
	readSource: (ref: SourceRef) => string,
	version = 1
): GeneratedSlot[] {
	return a.firmware.map((fw) => generateSlot(fw, a, readSource, version));
}
