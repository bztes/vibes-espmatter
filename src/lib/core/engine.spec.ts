import { describe, expect, it } from 'vitest';
import { assemble } from './assemble';
import { addPeripheral, createConfig, enableFeature, normalize, resolve, setBoard } from './engine';
import { generate, partitionTable } from './generate';
import { manualPairingCode, qrPayload } from './matter';
import { boards, features, peripherals } from './registry';
import { hasErrors, validate } from './validate';
import { checkEndpoint } from '#sdk/matter';
import { uiSpec } from '#lib/server/builds/device-ui.ts';

const errors = (config: ReturnType<typeof createConfig>) =>
	validate(config).filter((i) => i.severity === 'error');

describe('registry', () => {
	it('discovers boards, features and peripherals from plugins/', () => {
		expect(boards.all().length).toBeGreaterThan(10);
		expect(features.has('wifi')).toBe(true);
		expect(features.has('thread-border-router')).toBe(true);
		expect(peripherals.has('relay')).toBe(true);
		expect(peripherals.get('panasonic-heatpump').dir).toBe(
			'plugins/peripherals/panasonic-heatpump'
		);
	});

	it('has peripherals whose Matter endpoints match their device types', () => {
		for (const peripheral of peripherals.all()) {
			expect(peripheral.matter.endpoints.length, peripheral.id).toBeGreaterThan(0);
			expect(peripheral.matter.endpoints.flatMap(checkEndpoint), peripheral.id).toEqual([]);
		}
	});
});

describe('matter device types', () => {
	it('flags missing required clusters and unknown types', () => {
		expect(checkEndpoint({ deviceType: 0x0101, clusters: [0x0006] })).toEqual([
			'Dimmable Light requires the Level Control cluster'
		]);
		expect(checkEndpoint({ deviceType: 0x0101, clusters: [0x0006, 0x0008] })).toEqual([]);
		// @ts-expect-error not a known device type
		expect(checkEndpoint({ deviceType: 0x7777, clusters: [] })).toEqual([
			'unknown device type 0x7777'
		]);
	});
});

describe('matter onboarding', () => {
	it('computes the manual pairing code of the spec example', () => {
		expect(manualPairingCode(3840, 20202021)).toBe('3497-011-2332');
	});
	it('encodes the QR payload of the CHIP test device', () => {
		expect(qrPayload(0xfff1, 0x8000, 3840, 20202021, 2)).toBe('MT:Y.K9042C00KA0648G00');
	});
});

describe('hub', () => {
	it('starts with working defaults', () => {
		const hub = createConfig('hub', 'Hub');
		hub.features.wifi.ssid = 'Home';
		hub.features.wifi.password = 'secret123';
		expect(Object.keys(hub.features)).toEqual(
			expect.arrayContaining(['wifi', 'matter-controller', 'admin-ui'])
		);
		expect(errors(hub)).toEqual([]);
	});

	it('has the dashboard as an option of the Matter controller', () => {
		const hub = createConfig('hub', 'Hub');
		const pages = (h: typeof hub) =>
			assemble(h, { version: 1, buildId: 'b1' }).pages.map((p) => p.id);
		expect(hub.features['matter-controller'].dashboard).toBe(true);
		expect(pages(hub)).toEqual(['dashboard', 'settings']);
		hub.features['matter-controller'].dashboard = false;
		expect(pages(hub)).toEqual(['settings']);
	});

	it('adds automations and scenes with a page for every account', () => {
		const hub = createConfig('hub', 'Hub');
		hub.features['matter-controller'].automations = true;
		const a = assemble(hub, { version: 1, buildId: 'b1' });
		expect(a.pages.map((p) => p.id)).toEqual(['dashboard', 'automations', 'settings']);
		const shown = (page: string) =>
			a.widgets.filter((w) => w.page === page && w.access === 'account').map((w) => w.file);
		expect(shown('automations')).toEqual(['AutomationsWidget.svelte']);
		// Scenes on the dashboard; without one, next to the automations.
		expect(shown('dashboard')).toContain('ScenesWidget.svelte');
		hub.features['matter-controller'].dashboard = false;
		const b = assemble(hub, { version: 1, buildId: 'b1' });
		expect(b.widgets.filter((w) => w.page === 'automations').map((w) => w.file)).toEqual([
			'AutomationsWidget.svelte',
			'ScenesWidget.svelte'
		]);
		const [main] = generate(a, (ref) => `// ${ref.dir}/${ref.file}`, 1);
		const config = main.files['main/espm_config.h'];
		expect(config).toContain('#define ESPM_CTRL_AUTOMATIONS 1');
		expect(config).toMatch(/#define ESPM_CTRL_TZ \(espm_cfg_str\(.*"timezone"/);
		expect(main.files['main/CMakeLists.txt']).toContain('"espm_scenes.cpp"');
		expect(main.files['main/CMakeLists.txt']).toContain('"espm_time.cpp"');
		expect(main.files['main/app_main.cpp']).toContain('espm_time_sync(ESPM_CTRL_NTP);');
	});

	it('puts spot items of plugins into the web interface', () => {
		const hub = createConfig('hub', 'Hub');
		enableFeature(hub, 'history');
		const a = assemble(hub, { version: 1, buildId: 'b1' });
		expect(a.spotItems.map((x) => [x.spot, x.file])).toEqual([
			['device-icons', 'HistoryDeviceIcon.svelte']
		]);
		expect(uiSpec(a).spotItems).toEqual([
			{ spot: 'device-icons', module: 'plugins/features/history/ui/HistoryDeviceIcon.svelte' }
		]);
	});

	it('is only a Matter controller, no Matter device', () => {
		const build = { version: 1, buildId: 'b1' };
		const hub = createConfig('hub', 'Hub');
		hub.features.wifi.ssid = 'Home';
		hub.features.wifi.password = 'secret123';
		expect(errors(hub)).toEqual([]);
		const a = assemble(hub, build);
		const [main] = generate(a, (ref) => `// ${ref.dir}/${ref.file}`, 1);
		expect(main.files['sdkconfig.defaults']).toContain(
			'# CONFIG_ESP_MATTER_ENABLE_MATTER_SERVER is not set'
		);
		expect(main.files['main/espm_config.h']).toContain('#define ESPM_MATTER_SERVER 0');
		expect(a.widgets.map((w) => w.file)).not.toContain('MatterWidget.svelte');
		expect(a.api.some((r) => r.path.startsWith('/api/v1/matter'))).toBe(false);

		const dev = createConfig('device', 'Sensor');
		addPeripheral(dev, 'climate-sensor');
		enableFeature(dev, 'admin-ui');
		const d = assemble(dev, build);
		expect(d.widgets.map((w) => w.file)).toContain('MatterWidget.svelte');
		expect(d.api.some((r) => r.path === '/api/v1/matter')).toBe(true);
	});

	it('adds a radio board with the border router and wires it', () => {
		const hub = createConfig('hub', 'Hub');
		enableFeature(hub, 'thread-border-router');
		const r = resolve(hub);
		expect(r.slots.map((s) => s.id)).toEqual(['main', 'radio']);
		const tbr = hub.features['thread-border-router'];
		expect(Number(tbr.hostTx)).toBeGreaterThanOrEqual(0);
		expect(tbr.hostTx).not.toBe(tbr.hostRx);
		// Espressif's border router wiring on the S3: TX 18 → radio RX 23, RX 17 ← radio TX 24.
		expect([tbr.hostTx, tbr.hostRx]).toEqual([18, 17]);
		const a = assemble(hub);
		expect(a.wires.length).toBeGreaterThanOrEqual(4);
		expect(a.firmware.find((f) => f.slot.id === 'radio')?.sources.map((s) => s.file)).toContain(
			'espm_rcp.c'
		);
	});

	it('flashes the radio over the wires', () => {
		const hub = createConfig('hub', 'Hub');
		enableFeature(hub, 'thread-border-router');
		const tbr = hub.features['thread-border-router'];
		// The radio's UART is on the pins its ROM listens on in download mode (H2: TX 24, RX 23).
		expect([tbr.radioTx, tbr.radioRx]).toEqual([24, 23]);
		expect(Number(tbr.hostTrigger)).toBeGreaterThanOrEqual(0);
		// The SuperMini has BOOT (GPIO9) on its header: the trigger goes there, without a warning.
		expect(tbr.radioTrigger).toBe(9);
		expect(validate(hub).filter((i) => i.field === 'radioTrigger')).toEqual([]);
		expect(errors(hub)).toEqual([]);

		const a = assemble(hub);
		const radio = a.firmware.find((f) => f.slot.id === 'radio')!;
		expect(radio.sources.map((s) => s.file)).toContain('espm_slotboot.c');
		expect(radio.defines.ESPM_SLOTBOOT_TRIGGER).toBe(tbr.radioTrigger);
		expect(a.wires.some((w) => w.label.startsWith('Update trigger'))).toBe(true);

		const main = a.firmware.find((f) => f.slot.id === 'main')!;
		expect(main.defines.ESPM_SLOTFLASH).toBe(true);
		expect(a.api.some((r) => r.path === '/api/v1/slots')).toBe(true);

		// The hub doesn't carry the radio's firmware: it fetches updates from the app.
		const generated = generate(a, () => '');
		const mainProject = generated.find((g) => g.slot === 'main')!;
		expect(mainProject.files['main/CMakeLists.txt']).not.toContain('slot_radio');
		const table = mainProject.files['main/espm_slots.c'];
		expect(table).toContain('.trigger = ' + tbr.hostTrigger);
		expect(table).toContain('.force_reg = 0x600b1034');
		expect(table).toContain('.app_offset = 0x20000');
		expect(generated.find((g) => g.slot === 'radio')?.wired).toBe(true);
	});

	it('moves the radio UART to UART0 when the radio board changes', () => {
		const hub = createConfig('hub', 'Hub');
		enableFeature(hub, 'thread-border-router');
		setBoard(hub, 'radio', 'waveshare-esp32-h2-zero');
		const tbr = hub.features['thread-border-router'];
		// No BOOT pin on the H2-Zero's header: any free GPIO.
		expect([tbr.radioTx, tbr.radioRx]).toEqual([24, 23]);
		expect(tbr.radioTrigger).not.toBe(9);
		expect(Number(tbr.radioTrigger)).toBeGreaterThanOrEqual(0);
		expect(errors(hub)).toEqual([]);

		setBoard(hub, 'radio', 'esp32-c6-devkitc-1');
		expect([tbr.radioTx, tbr.radioRx]).toEqual([16, 17]);
		expect(errors(hub)).toEqual([]);

		tbr.radioTx = 5;
		expect(errors(hub).some((i) => i.field === 'radioTx' && i.message.includes('UART0'))).toBe(
			true
		);
	});

	it('needs an uplink', () => {
		const hub = createConfig('hub', 'Hub');
		delete hub.features.wifi;
		expect(errors(hub).some((i) => i.message.includes('uplink'))).toBe(true);
	});

	it('rejects a radio board without 802.15.4', () => {
		const hub = createConfig('hub', 'Hub');
		enableFeature(hub, 'thread-border-router');
		setBoard(hub, 'radio', 'esp32-c3-supermini');
		expect(errors(hub).some((i) => i.scope === 'board:radio')).toBe(true);
	});
});

describe('device', () => {
	it('can not use Wi-Fi on an H2', () => {
		const dev = createConfig('device', 'Sensor');
		enableFeature(dev, 'wifi');
		dev.boards.main = 'esp32-h2-supermini';
		expect(errors(dev).some((i) => i.scope === 'feature:wifi')).toBe(true);
		// Switching the board picks a transport it supports.
		setBoard(dev, 'main', 'esp32-h2-supermini');
		expect(dev.features.wifi).toBeUndefined();
		expect(dev.features.thread).toBeDefined();
		expect(errors(dev).some((i) => i.scope === 'feature:wifi')).toBe(false);
	});

	it('assigns free pins and lets I2C sensors share a bus', () => {
		const dev = createConfig('device', 'Multi');
		const a = addPeripheral(dev, 'climate-sensor');
		const b = addPeripheral(dev, 'climate-sensor');
		b.settings.model = 'sht3x-b';
		const relay = addPeripheral(dev, 'relay');
		expect(a.settings.sda).toBe(b.settings.sda);
		expect(relay.settings.gpio).not.toBe(a.settings.sda);
		expect(relay.settings.gpio).not.toBe(a.settings.scl);
		expect(errors(dev)).toEqual([]);
	});

	it('reports pin conflicts and input-only pins', () => {
		const dev = createConfig('device', 'Bad');
		setBoard(dev, 'main', 'esp32-devkitc');
		const r1 = addPeripheral(dev, 'relay');
		const r2 = addPeripheral(dev, 'relay');
		r2.settings.gpio = r1.settings.gpio;
		expect(errors(dev).some((i) => i.message.includes('already used'))).toBe(true);
		r2.settings.gpio = 34;
		expect(errors(dev).some((i) => i.message.includes('input only'))).toBe(true);
		r2.settings.gpio = 6;
		expect(errors(dev).some((i) => i.message.includes('flash'))).toBe(true);
	});

	it('rejects an ESP32-S2 (no Matter)', () => {
		const dev = createConfig('device', 'S2');
		setBoard(dev, 'main', 'generic-esp32-s2-mini');
		expect(hasErrors(validate(dev))).toBe(true);
	});

	it('generates an ESP-IDF project with every peripheral', () => {
		const dev = createConfig('device', 'Living room');
		addPeripheral(dev, 'relay', 'Lamp');
		addPeripheral(dev, 'climate-sensor');
		enableFeature(dev, 'admin-ui');
		const a = assemble(dev, { version: 7, buildId: 'b1' });
		const [main] = generate(a, (ref) => `// ${ref.dir}/${ref.file}`, 7);
		expect(main.files['main/app_main.cpp']).toContain('espm_relay_add({"');
		expect(main.files['main/app_main.cpp']).toContain('espm_climate_add(');
		expect(main.files['main/CMakeLists.txt']).toContain('espm_relay.cpp');
		expect(main.files['main/espm_config.h']).toContain('#define ESPM_FW_VERSION 7');
		expect(main.files['main/espm_config.h']).toContain('#define ESPM_UPDATE_PULL 1');
		expect(main.files['sdkconfig.defaults']).toContain('CONFIG_IDF_TARGET="esp32c6"');
		expect(main.needsUi).toBe(true);
		expect(a.api.some((r) => r.path.startsWith('/api/v1/peripherals/'))).toBe(true);
	});

	it('pulls through the hub on Thread', () => {
		const dev = createConfig('device', 'Thread sensor');
		setBoard(dev, 'main', 'esp32-h2-supermini');
		enableFeature(dev, 'thread');
		addPeripheral(dev, 'contact-sensor');
		const a = assemble(dev);
		const defines = a.firmware[0].defines;
		expect(defines.ESPM_UPDATE_VIA_HUB).toBe(true);
	});
});

describe('normalize', () => {
	it('survives garbage', () => {
		const c = normalize({
			kind: 'nope',
			boards: 5,
			peripherals: [{ peripheral: 'relay', uid: '../x' }, null]
		});
		expect(c.kind).toBe('device');
		expect(c.peripherals).toHaveLength(1);
		expect(c.peripherals[0].uid).toMatch(/^[a-z0-9]+$/);
	});
});

describe('partitions', () => {
	it('fits two OTA slots and the device configuration into 4 MB', () => {
		const a = assemble(createConfig('device', 'X'));
		const table = partitionTable(a.firmware[0]);
		expect(table).toContain('ota_0, app, ota_0, 0x20000,');
		expect(table).toContain('ota_1');
		expect(table).toContain('espm_cfg, data, nvs, 0x18000, 0x4000,');
		const [main] = generate(a, () => '');
		expect(main.configPartition).toEqual({ offset: 0x18000, size: 0x4000 });
	});
});
