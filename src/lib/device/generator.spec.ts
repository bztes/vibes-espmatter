import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
	addFeature,
	apiRoutes,
	canAddFeature,
	changeBoard,
	defaultProject,
	featuresDroppedBy,
	generateProject,
	newChip,
	externalParts,
	normalizeProject,
	generatedHash,
	projectHash,
	requiredBy,
	validateProject,
	wiring
} from './generator';
import { features } from './registry';
import { boardGpios } from './pins';
import { boards } from './registry';
import type { ProjectConfig } from './types';
import { cString, slugify } from './util';
import {
	formatManualCode,
	manualPairingCode,
	qrCodePayload,
	toValidPasscode,
	validPasscode
} from './features/matter-device/onboarding';

const chip = (project: ProjectConfig, id: string) => project.chips.find((c) => c.id === id)!;

function hubProject() {
	const project = defaultProject('matter-hub', 'Test Hub');
	chip(project, 'host').features.wifi.ssid = 'MyWifi';
	chip(project, 'host').features.wifi.password = 'secret-password';
	chip(project, 'host').features.http_server.password = 'initial-pw';
	return project;
}

describe('generator', () => {
	it('creates valid devices from templates', () => {
		const project = hubProject();
		expect(validateProject(project)).toEqual([]);
		expect(project.chips.map((c) => [c.id, c.board])).toEqual([
			['host', 'esp32-s3-devkitc-1'],
			['radio', 'esp32-h2-supermini']
		]);
		expect(chip(project, 'host').features.thread_br.rxGpio).toBe(17);
		expect(chip(project, 'radio').features.openthread_rcp.txGpio).toBe(24);
		// every chip has the chip & memory feature
		expect(project.chips.every((c) => 'device' in c.features)).toBe(true);
	});

	it('starts empty devices with one chip without features', () => {
		const project = defaultProject(undefined, 'Lamp');
		expect(project.chips).toHaveLength(1);
		expect(Object.keys(project.chips[0].features)).toEqual(['device']);
		expect(validateProject(project).map((i) => i.message)).toContain(
			'Main board has no features yet.'
		);
	});

	it('adds required features and refuses incompatible ones', () => {
		const project = defaultProject();
		const main = project.chips[0];
		addFeature(main, 'admin_dashboard');
		expect(Object.keys(main.features).sort()).toEqual([
			'admin_dashboard',
			'device',
			'http_server',
			'web_ui'
		]);
		expect(requiredBy(main, 'http_server').map((f) => f.id)).toEqual(['web_ui']);
		expect(requiredBy(main, 'web_ui').map((f) => f.id)).toEqual(['admin_dashboard']);
		// RCP needs an 802.15.4 chip and plain ESP-IDF
		expect(canAddFeature(main, features.get('openthread_rcp'))).toMatch(/needs esp32h2/);
		const radio = newChip(project, 'waveshare-esp32-h2-zero');
		expect(canAddFeature(radio, features.get('openthread_rcp'))).toBeUndefined();
	});

	it('drops unsupported features and their dependents when the board changes', () => {
		const main = defaultProject().chips[0];
		addFeature(main, 'ntp'); // needs wifi
		const h2 = boards.get('esp32-h2-supermini');
		const dropped = featuresDroppedBy(main, h2).map((f) => f.id);
		expect(dropped).toEqual(expect.arrayContaining(['wifi', 'ntp']));
		expect(featuresDroppedBy(main, boards.get('esp32-s3-supermini'))).toEqual([]);
		changeBoard(main, h2);
		expect(main.board).toBe(h2.id);
		for (const id of dropped) expect(main.features).not.toHaveProperty(id);
	});

	it('needs a radio chip for the border router', () => {
		const project = hubProject();
		project.chips = project.chips.filter((c) => c.id !== 'radio');
		expect(
			validateProject(project)
				.map((i) => i.message)
				.join()
		).toContain('Thread radio (RCP)');
	});

	it('reports missing wifi credentials and duplicate pins', () => {
		const project = defaultProject('matter-hub');
		chip(project, 'host').features.thread_br.txGpio = 17;
		const issues = validateProject(project).map((i) => i.message);
		expect(issues).toContain('Network name (SSID) is required.');
		expect(issues.some((m) => m.includes('GPIO17 is used twice'))).toBe(true);
	});

	it('normalizes untrusted input', () => {
		const project = normalizeProject({
			version: 2,
			name: 'x',
			chips: [
				{
					id: 'Bad ID!',
					name: 'A',
					board: 'nope',
					features: { wifi: { ssid: 123, bogus: true }, nope: {} }
				}
			]
		});
		expect(project.chips[0].id).toBe('chip-1');
		expect(project.chips[0].board).toBe('esp32-s3-devkitc-1');
		expect(project.chips[0].features.wifi).toEqual({ ssid: '123', password: '', hostname: '' });
		expect('nope' in project.chips[0].features).toBe(false);
	});

	it('migrates the admin interface and the dashboard of saved devices', () => {
		const project = normalizeProject({
			version: 2,
			name: 'x',
			chips: [
				{
					id: 'host',
					name: 'Host',
					board: 'esp32-s3-devkitc-1',
					features: { matter_controller: {}, admin_ui: {}, dashboard: { path: '/home' } }
				}
			]
		});
		const { features } = project.chips[0];
		expect(Object.keys(features)).toEqual(
			expect.arrayContaining(['admin_dashboard', 'user_dashboard', 'timers', 'automations'])
		);
		expect('admin_ui' in features || 'dashboard' in features).toBe(false);
		expect(features.user_dashboard.path).toBe('/home');
	});

	it('extends the dashboards only with the features that are there', () => {
		const project = defaultProject(undefined, 'Plain');
		const main = project.chips[0];
		addFeature(main, 'matter_controller');
		addFeature(main, 'admin_dashboard');
		main.features.wifi.ssid = 'MyWifi';
		main.features.http_server.password = 'initial-pw';
		const [gen] = generateProject(project);
		expect(gen.ui.map((u) => u.page)).toEqual(['admin']);
		const ids = gen.ui[0].panels.map((p) => p.id);
		expect(ids).toContain('matter');
		// no user dashboard: no tiles and no access to them; no automations or timers either
		expect(ids).not.toContain('access');
		expect(ids).not.toContain('automations');
		expect(gen.files).not.toHaveProperty('main/espm_timers.cpp');
		expect(gen.files).not.toHaveProperty('main/espm_automation.cpp');
		expect(gen.files).not.toHaveProperty('main/espm_scenes.cpp');
		// the controller's own API is always there with the HTTP server
		expect(gen.files['main/app_main.cpp']).toContain('mesp_matter_register_web();');
	});

	it('runs timers, scenes and automations without the dashboards, through the API', () => {
		const project = defaultProject(undefined, 'Plain');
		const main = project.chips[0];
		addFeature(main, 'timers');
		addFeature(main, 'scenes');
		addFeature(main, 'automations');
		main.features.wifi.ssid = 'MyWifi';
		main.features.http_server.password = 'initial-pw';
		expect(main.features).not.toHaveProperty('user_dashboard');
		expect(main.features).not.toHaveProperty('admin_dashboard');
		const [gen] = generateProject(project);
		expect(gen.ui).toEqual([]);
		expect(gen.files).toHaveProperty('main/espm_timers.cpp');
		expect(gen.files).toHaveProperty('main/espm_automation.cpp');
		const app = gen.files['main/app_main.cpp'];
		expect(app).toContain('mesp_timers_register_web();');
		expect(app).toContain('mesp_automation_register_web();');
		expect(gen.files).toHaveProperty('main/espm_scenes.cpp');
		expect(app).toContain('mesp_scenes_register_web();');
	});

	it('generates both firmwares, radio first', () => {
		const [radio, host] = generateProject(hubProject());
		expect(radio.role.id).toBe('radio');
		expect(radio.target).toBe('esp32h2');
		expect(radio.files['main/app_main.c']).toContain('mesp_rcp_start();');
		expect(radio.files['main/espm_config.h']).toContain('#define MESP_RCP_TX_PIN 24');

		expect(host.target).toBe('esp32s3');
		expect(host.files['sdkconfig.defaults']).toContain('CONFIG_OPENTHREAD_BORDER_ROUTER=y');
		expect(host.files['sdkconfig.defaults']).toContain(
			'CONFIG_ESP_MATTER_ENABLE_MATTER_SERVER is not set'
		);
		expect(host.files['main/idf_component.yml']).toContain('espressif/esp_matter');
		expect(host.files['main/CMakeLists.txt']).toContain(
			'EMBED_FILES "dashboard.html.gz" "admin.html.gz"'
		);
		// in menu order (by path): the user dashboard at `/` first
		const [dash, admin] = host.ui;
		expect(admin.page).toBe('admin');
		expect(admin.layout).toBe('features/admin-dashboard/device-ui/SetupLayout.svelte');
		expect(admin.panels.map((p) => p.module)).toContain(
			'features/matter-controller/device-ui/MatterPanel.svelte'
		);
		// the HTTP server's panels and the features' panels; the dashboards bring none
		expect(admin.panels.map((p) => p.id)).toEqual(
			expect.arrayContaining(['system', 'users', 'automations'])
		);
		expect(admin.panels.map((p) => p.module)).toContain(
			'features/automations/device-ui/AutomationPanel.svelte'
		);
		expect(host.ui.flatMap((u) => u.panels).filter((p) => /dashboard\//.test(p.module))).toEqual(
			[]
		);
		// which lights each user gets is the Matter controller's, shown on the admin dashboard
		expect(admin.panels.map((p) => p.id)).toContain('access');
		expect(host.files['main/CMakeLists.txt']).toContain('"espm_matter_access.cpp"');
		// the user dashboard is its own page with the controller's tiles and the timers
		expect(dash.page).toBe('dashboard');
		expect(dash.panels.map((p) => p.module)).toEqual([
			'features/matter-controller/device-ui/TilesPanel.svelte',
			'features/scenes/device-ui/ScenesPanel.svelte',
			'features/timers/device-ui/TimersPanel.svelte'
		]);
		// scenes are shared with other users on the admin dashboard
		expect(admin.panels.find((p) => p.id === 'scene-sharing')?.section).toBe('users');
		// the time zone is set on the device, not at build time
		expect(host.files['main/espm_config.h']).not.toContain('MESP_TZ');
		// timer routes are registered before the HTTP server starts
		const app = host.files['main/app_main.cpp'];
		expect(app.indexOf('mesp_timers_register_web')).toBeLessThan(app.indexOf('mesp_web_start'));
		expect(app.indexOf('mesp_automation_register_web')).toBeLessThan(app.indexOf('mesp_web_start'));
		// button events reach the automations through the controller's subscriptions
		expect(app.indexOf('mesp_matter_subscriptions_init();')).toBeLessThan(
			app.lastIndexOf('mesp_automation_init();')
		);
		expect(dash.layout).toBe('features/user-dashboard/device-ui/DashboardLayout.svelte');
		expect(dash.pages.map((p) => [p.id, p.path, p.access])).toEqual([
			['dashboard', '/', 'user'],
			['admin', '/admin', 'admin']
		]);
		expect(radio.ui).toEqual([]);
		expect(host.files['main/espm_config.h']).toContain('#define MESP_WIFI_SSID "MyWifi"');
		expect(host.files['partitions.csv']).toContain('ota_1');
		expect(host.files['main/espm_config.h']).toContain('#define MESP_OTA 1');
		// only the host has "Over-the-air updates": the Thread radio has no OTA slots
		expect(radio.files['partitions.csv']).not.toContain('ota_1');
		// web server must start after all routes are registered
		const main = host.files['main/app_main.cpp'];
		expect(main.indexOf('mesp_matter_register_web')).toBeLessThan(main.indexOf('mesp_web_start'));
		// Wi-Fi settings can be changed on the device
		expect(main.indexOf('mesp_wifi_register_web')).toBeLessThan(main.indexOf('mesp_web_start'));

		if (process.env.GEN_OUT) {
			for (const p of [radio, host]) {
				for (const [file, content] of Object.entries(p.files)) {
					const path = join(process.env.GEN_OUT, p.role.id, file);
					mkdirSync(dirname(path), { recursive: true });
					writeFileSync(path, content);
				}
			}
		}
	});

	it('protects the HTTP server with a login', () => {
		const project = hubProject();
		chip(project, 'host').features.http_server.password = '';
		expect(validateProject(project).map((i) => i.message)).toContain(
			'The initial admin password needs at least 6 characters.'
		);
		const host = generateProject(hubProject())[1];
		expect(host.files['main/CMakeLists.txt']).toContain('espm_auth.cpp');
		// the login routes are registered before the HTTP server starts
		const app = host.files['main/app_main.cpp'];
		expect(app.indexOf('mesp_auth_register_routes')).toBeLessThan(app.indexOf('mesp_web_start'));
	});

	it('serves no pages with only the HTTP server', () => {
		const project = defaultProject(undefined, 'Plain');
		addFeature(project.chips[0], 'http_server');
		const [main] = generateProject(project);
		expect(main.ui).toEqual([]);
		expect(main.files['main/CMakeLists.txt']).not.toContain('EMBED_FILES');
		expect(main.files).not.toHaveProperty('main/espm_web_ui.cpp');
	});

	it('wires host UART to radio UART', () => {
		const wires = wiring(hubProject());
		expect(wires[0].from.pin).toBe('gpio:18');
		expect(wires[0].to.pin).toBe('gpio:23');
		// the radio is fed from the host's 3V3 rail, not 5V
		expect(wires.some((w) => w.from.pin === '3V3' && w.to.pin === '3V3')).toBe(true);
		expect(wires.some((w) => w.from.pin === '5V' || w.to.pin === '5V')).toBe(false);
	});

	it('flashes the radio first and wires its UART once', () => {
		const project = hubProject();
		const [radio] = generateProject(project);
		expect(radio.role.id).toBe('radio');
		const wires = wiring(project);
		// the shared UART and ground are drawn once
		expect(wires.filter((w) => w.label === 'Ground')).toHaveLength(1);
		expect(wires.filter((w) => w.to.pin === 'gpio:23')).toHaveLength(1);
		expect(new Set(wires.map((w) => w.label)).size).toBe(wires.length);
	});

	it('hash changes with config', () => {
		const a = hubProject();
		const b = hubProject();
		expect(projectHash(a)).toBe(projectHash(b));
		chip(b, 'host').features.wifi.ssid = 'Other';
		expect(projectHash(a)).not.toBe(projectHash(b));
	});

	it('build key covers the generated firmware, not just the config', () => {
		const a = hubProject();
		expect(generatedHash(a)).toBe(generatedHash(hubProject()));
		chip(a, 'host').features.wifi.ssid = 'Other';
		expect(generatedHash(a)).not.toBe(generatedHash(hubProject()));
		// a firmware source that changes while the config stays the same must rebuild too
		const host = generateProject(hubProject()).find((r) => r.role.id === 'host')!;
		expect(Object.keys(host.files)).toContain('main/espm_thread.cpp');
	});
});

function heatPumpProject() {
	const project = defaultProject('panasonic-heat-pump', 'Living room heat pump');
	chip(project, 'main').features.wifi.ssid = 'MyWifi';
	chip(project, 'main').features.wifi.password = 'secret-password';
	return project;
}

describe('panasonic heat pump', () => {
	it('creates a valid single-chip device', () => {
		const project = heatPumpProject();
		expect(validateProject(project)).toEqual([]);
		const main = chip(project, 'main');
		expect(main.board).toBe('esp32-s3-supermini');
		expect(main.features.panasonic_ac).toMatchObject({ port: 'cnt', rxGpio: 4, txGpio: 5 });
		// the BOOT button (GPIO0) isn't on the SuperMini's header but is a valid reset button
		expect(main.features.matter_device.resetGpio).toBe(0);
	});

	it('generates a commissionable Matter device', () => {
		const [main] = generateProject(heatPumpProject());
		const config = main.files['main/espm_config.h'];
		const sdk = main.files['sdkconfig.defaults'];
		const app = main.files['main/app_main.cpp'];
		expect(main.target).toBe('esp32s3');
		expect(sdk).toContain('CONFIG_CUSTOM_COMMISSIONABLE_DATA_PROVIDER=y');
		expect(sdk).not.toContain('CONFIG_ESP_MATTER_ENABLE_MATTER_SERVER');
		expect(config).toContain('#define MESP_PAC_PROTOCOL_CNT 1');
		expect(config).toContain('#define MESP_PAC_RX_GPIO 4');
		expect(config).toMatch(/#define MESP_MATTER_PASSCODE \d+/);
		expect(main.files['main/matter_project_config.h']).toContain(
			'#define CHIP_DEVICE_CONFIG_DEVICE_PRODUCT_NAME "Living room heat pump"'
		);
		expect(main.files['main/CMakeLists.txt']).toContain('"espm_pac_matter.cpp"');
		// node first, then the endpoint, then the Matter stack; the UART after it
		expect(app.indexOf('mesp_node_init();')).toBeLessThan(app.indexOf('mesp_pac_matter_init();'));
		expect(app.indexOf('mesp_pac_matter_init();')).toBeLessThan(app.indexOf('esp_matter::start'));
		expect(app.indexOf('esp_matter::start')).toBeLessThan(app.indexOf('mesp_pac_matter_start();'));
		expect(main.notes.join('\n')).toMatch(/Matter pairing code: \d{4}-\d{3}-\d{4} \(QR code: MT:/);

		if (process.env.GEN_OUT) {
			for (const [file, content] of Object.entries(main.files)) {
				const path = join(process.env.GEN_OUT, 'heat-pump', file);
				mkdirSync(dirname(path), { recursive: true });
				writeFileSync(path, content);
			}
		}
	});

	it('derives a stable setup code per device unless one is set', () => {
		const a = generateProject(heatPumpProject())[0].files['main/espm_config.h'];
		const b = generateProject(heatPumpProject())[0].files['main/espm_config.h'];
		expect(a).toBe(b);
		expect(a).not.toContain('MESP_MATTER_PASSCODE 20202021');
		const project = heatPumpProject();
		chip(project, 'main').features.matter_device.passcode = 24681357;
		chip(project, 'main').features.matter_device.discriminator = 1234;
		const config = generateProject(project)[0].files['main/espm_config.h'];
		expect(config).toContain('#define MESP_MATTER_PASSCODE 24681357');
		expect(config).toContain('#define MESP_MATTER_DISCRIMINATOR 1234');
		chip(project, 'main').features.matter_device.passcode = 12345678;
		expect(
			validateProject(project)
				.map((i) => i.message)
				.join()
		).toContain('Setup passcode');
	});

	it('wires the unit through a level converter', () => {
		const project = heatPumpProject();
		const parts = externalParts(project);
		expect(parts.map((p) => p.id)).toEqual(['level-converter', 'unit']);
		const wires = wiring(project);
		const board = boards.get('esp32-s3-supermini');
		const exists = ({ role, pin }: { role: string; pin: string }) => {
			if (role === 'main') {
				return pin.startsWith('gpio:')
					? boardGpios(board).some((p) => `gpio:${p.gpio}` === pin)
					: [...board.headers.left, ...board.headers.right].some((p) => p.label === pin);
			}
			const part = parts.find((p) => `part:${p.id}` === role);
			return [...(part?.headers.left ?? []), ...(part?.headers.right ?? [])].some(
				(p) => p.label === pin
			);
		};
		for (const wire of wires) {
			expect(exists(wire.from), `${wire.label}: ${wire.from.pin}`).toBe(true);
			expect(exists(wire.to), `${wire.label}: ${wire.to.pin}`).toBe(true);
		}
		// signals never go straight from the ESP32 to the unit
		expect(wires.some((w) => [w.from.role, w.to.role].sort().join() === 'main,part:unit')).toBe(
			false
		);
		expect(new Set(wires.map((w) => w.label)).size).toBe(wires.length);
		expect(wires.find((w) => w.label === 'Converter LV1 → ESP32 RX')?.to.pin).toBe('gpio:4');
	});

	it('selects the CN-WLAN protocol', () => {
		const project = heatPumpProject();
		chip(project, 'main').features.panasonic_ac.port = 'wlan';
		const config = generateProject(project)[0].files['main/espm_config.h'];
		expect(config).toContain('#define MESP_PAC_PROTOCOL_CNT 0');
	});

	it("can't be a Matter device and a controller on one chip", () => {
		const project = hubProject();
		addFeature(chip(project, 'host'), 'matter_device');
		expect(validateProject(project).map((i) => i.message)).toContain(
			'A board is either a Matter device or a Matter controller (hub), not both.'
		);
	});
});

describe('opentelemetry metrics', () => {
	function metricsProject() {
		const project = heatPumpProject();
		addFeature(chip(project, 'main'), 'otel_metrics');
		chip(project, 'main').features.otel_metrics.endpoint =
			'https://o2.example.com/api/default/v1/metrics';
		chip(project, 'main').features.otel_metrics.authorization = 'Basic dXNlcjpwdw==';
		return project;
	}

	it('needs an http(s) endpoint', () => {
		const project = metricsProject();
		expect(validateProject(project)).toEqual([]);
		chip(project, 'main').features.otel_metrics.endpoint = 'o2.example.com';
		expect(validateProject(project).map((i) => i.field)).toContain('endpoint');
		// no admin dashboard on the heat pump to set it on the device
		chip(project, 'main').features.otel_metrics.endpoint = '';
		expect(validateProject(project).map((i) => i.message)).toContain(
			'OpenTelemetry needs an OTLP endpoint (or the admin dashboard to set it on the device).'
		);
	});

	it('sends the heat pump’s readings', () => {
		const [main] = generateProject(metricsProject());
		const config = main.files['main/espm_config.h'];
		const app = main.files['main/app_main.cpp'];
		expect(config).toContain('#define MESP_OTEL 1');
		expect(config).toContain(
			'#define MESP_OTEL_ENDPOINT "https://o2.example.com/api/default/v1/metrics"'
		);
		expect(config).toContain('#define MESP_OTEL_AUTH "Basic dXNlcjpwdw=="');
		// empty: the firmware uses the hostname
		expect(config).toContain('#define MESP_OTEL_SERVICE ""');
		expect(config).toContain('#define MESP_OTEL_INTERVAL_S 60');
		// timestamps need the clock: the time server feature comes with it
		expect(chip(metricsProject(), 'main').features.ntp).toEqual({ server: 'pool.ntp.org' });
		expect(config).toContain('#define MESP_NTP_SERVER "pool.ntp.org"');
		expect(main.files['main/CMakeLists.txt']).toContain('"espm_ntp.cpp"');
		expect(main.files['sdkconfig.defaults']).toContain('CONFIG_MBEDTLS_CERTIFICATE_BUNDLE=y');
		expect(main.files['main/CMakeLists.txt']).toContain('"espm_otel.cpp"');
		// the metric table exists before the heat pump records into it
		expect(app.indexOf('mesp_otel_init();')).toBeLessThan(app.indexOf('mesp_pac_matter_init();'));
		expect(app.indexOf('esp_matter::start')).toBeLessThan(app.indexOf('mesp_otel_start();'));
	});

	it('sends logs if enabled', () => {
		const project = metricsProject();
		let config = generateProject(project)[0].files['main/espm_config.h'];
		expect(config).toContain('#define MESP_OTEL_LOGS 0');
		chip(project, 'main').features.otel_metrics.logs = true;
		chip(project, 'main').features.otel_metrics.logLevel = 'info';
		expect(validateProject(project)).toEqual([]);
		config = generateProject(project)[0].files['main/espm_config.h'];
		expect(config).toContain('#define MESP_OTEL_LOGS 1');
		expect(config).toContain('#define MESP_OTEL_LOG_LEVEL "I"');
		expect(config).toContain('#define MESP_OTEL_LOG_INTERVAL_S 0');
		expect(config).toContain('#define MESP_OTEL_METRICS 1');
		// logs only
		chip(project, 'main').features.otel_metrics.metrics = false;
		expect(validateProject(project)).toEqual([]);
		expect(generateProject(project)[0].files['main/espm_config.h']).toContain(
			'#define MESP_OTEL_METRICS 0'
		);
		chip(project, 'main').features.otel_metrics.logs = false;
		expect(validateProject(project).map((i) => i.message)).toContain(
			'OpenTelemetry: switch on metrics, logs or both.'
		);
		chip(project, 'main').features.otel_metrics.logs = true;
		// one base URL: the firmware adds /v1/metrics and /v1/logs
		chip(project, 'main').features.otel_metrics.endpoint = 'http://o2.local:4318';
		expect(validateProject(project)).toEqual([]);
	});

	it('tells an outdated build by the config hash', () => {
		// The build's stored config and the edited one are both normalized before hashing.
		const project = metricsProject();
		const built = projectHash(normalizeProject(structuredClone(project)));
		expect(projectHash(normalizeProject(normalizeProject(project)))).toBe(built);
		chip(project, 'main').features.otel_metrics.logs = true;
		expect(projectHash(normalizeProject(project))).not.toBe(built);
	});

	it('takes the hostname from Wi-Fi, or the project name', () => {
		const project = metricsProject();
		project.name = 'Heat Pump';
		let config = generateProject(project)[0].files['main/espm_config.h'];
		expect(config).toContain('#define MESP_HOSTNAME "heat-pump"');
		chip(project, 'main').features.wifi.hostname = 'WP-Keller';
		expect(validateProject(project)).toEqual([]);
		config = generateProject(project)[0].files['main/espm_config.h'];
		expect(config).toContain('#define MESP_HOSTNAME "wp-keller"');
		expect(config.match(/#define MESP_HOSTNAME /g)).toHaveLength(1);
		chip(project, 'main').features.wifi.hostname = 'wp keller';
		expect(validateProject(project).map((i) => i.field)).toContain('hostname');
	});

	it('is off unless added', () => {
		const [main] = generateProject(heatPumpProject());
		expect(main.files['main/espm_config.h']).toContain('#define MESP_OTEL 0');
		expect(main.files['main/CMakeLists.txt']).not.toContain('espm_otel.cpp');
	});

	it('shares the time server with the timers', () => {
		const project = hubProject();
		addFeature(chip(project, 'host'), 'otel_metrics');
		chip(project, 'host').features.otel_metrics.endpoint =
			'http://o2.local:5080/api/default/v1/metrics';
		chip(project, 'host').features.ntp.server = 'fritz.box';
		expect(validateProject(project)).toEqual([]);
		const host = generateProject(project)[1];
		const config = host.files['main/espm_config.h'];
		expect(config).toContain('#define MESP_NTP_SERVER "fritz.box"');
		expect(host.files['main/app_main.cpp'].match(/mesp_ntp_start\(\);/g)).toHaveLength(1);
		// the endpoint can be changed on the admin dashboard, maybe to https
		expect(host.files['sdkconfig.defaults']).toContain('CONFIG_MBEDTLS_CERTIFICATE_BUNDLE=y');
		expect(host.files['main/app_main.cpp']).toContain('mesp_otel_register_web();');
		expect(host.ui.find((u) => u.page === 'admin')!.panels.map((p) => p.id)).toContain('otel');
	});

	it('can get its endpoint on the device', () => {
		const project = hubProject();
		addFeature(chip(project, 'host'), 'otel_metrics');
		expect(validateProject(project)).toEqual([]);
		const host = generateProject(project)[1];
		expect(host.files['main/espm_config.h']).toContain('#define MESP_OTEL_ENDPOINT ""');
		expect(host.notes.join('\n')).toContain('no endpoint yet');
	});
});

describe('home screen app', () => {
	/** Page id → its web app manifest (`espm_web_ui_pages.h`). */
	const manifests = (pages: string) =>
		Object.fromEntries(
			[...pages.matchAll(/\{"[^"]*", (\w+)_html_gz_start, \w+_html_gz_end, (".*")\},/g)].map(
				(m) => [m[1], JSON.parse(JSON.parse(m[2]))]
			)
		);

	it('makes the user and the admin dashboard two apps', () => {
		const host = generateProject(hubProject())[1];
		const apps = manifests(host.files['main/espm_web_ui_pages.h']);
		const dash = apps.dashboard;
		expect(dash).toMatchObject({ name: 'Test Hub', start_url: '/', display: 'standalone' });
		expect(apps.admin).toMatchObject({
			name: 'Test Hub Setup',
			start_url: '/admin'
		});
		expect(dash.icons.map((i: { src: string }) => i.src)).toContain('/icon.png');
		const icon = host.files['main/espm_icon.cpp'];
		// the PNG signature
		expect(icon).toContain('mesp_icon_png[] = {\n    0x89,0x50,0x4e,0x47');
		expect(icon).toContain('mesp_icon_svg[] = "<svg');
		expect(host.files['main/CMakeLists.txt']).toContain('"espm_icon.cpp"');
	});

	it('serves the pages at their configured paths', () => {
		const project = hubProject();
		delete chip(project, 'host').features.timers;
		delete chip(project, 'host').features.user_dashboard;
		chip(project, 'host').features.admin_dashboard.path = '/';
		const host = generateProject(project)[1];
		const apps = manifests(host.files['main/espm_web_ui_pages.h']);
		expect(Object.keys(apps)).toEqual(['admin']);
		expect(apps.admin).toMatchObject({ name: 'Test Hub', start_url: '/' });
		expect(host.ui).toHaveLength(1);
		expect(host.ui[0]).toMatchObject({ page: 'admin', path: '/', appName: 'Test Hub' });
		// panels that don't name a page go to the setup page
		expect(host.ui[0].panels.map((p) => p.id)).toContain('wifi');
	});

	it('refuses two pages at the same path and invalid paths', () => {
		const project = hubProject();
		chip(project, 'host').features.admin_dashboard.path = '/';
		const messages = () => validateProject(project).map((i) => i.message);
		expect(messages()).toContain('Another page is served at “/” too.');
		chip(project, 'host').features.admin_dashboard.path = '/api';
		expect(messages()).toContain('Path has an invalid format.');
	});
});

describe('matter onboarding codes', () => {
	// Test vectors of the Matter SDK (passcode 20202021, discriminator 3840, VID 0xFFF1, PID 0x8000).
	it('builds the manual pairing code', () => {
		expect(manualPairingCode(20202021, 3840)).toBe('34970112332');
		expect(formatManualCode('34970112332')).toBe('3497-011-2332');
	});
	it('builds the QR code payload', () => {
		expect(qrCodePayload({ passcode: 20202021, discriminator: 3840 })).toBe(
			'MT:Y.K9042C00KA0648G00'
		);
	});
	it('only produces valid passcodes', () => {
		expect(validPasscode(20202021)).toBe(true);
		for (const bad of [0, 11111111, 12345678, 87654321, 99999999, 100000000]) {
			expect(validPasscode(bad)).toBe(false);
		}
		expect(toValidPasscode(11111110)).toBe(11111112);
		for (const n of [0, 1, 99999997, 2 ** 32 - 1])
			expect(validPasscode(toValidPasscode(n))).toBe(true);
	});
});

describe('util', () => {
	it('escapes C strings', () => {
		expect(cString('a"b\\c\n')).toBe('"a\\"b\\\\c\\012"');
		expect(cString('ä')).toBe('"\\303\\244"');
	});
	it('slugifies', () => {
		expect(slugify('Mein Wohnzimmer Hub!')).toBe('mein-wohnzimmer-hub');
	});
});

describe('REST API docs', () => {
	/** `METHOD /api/…` of every route the generated firmware registers. */
	function registered(project: ProjectConfig, chipId: string): string[] {
		const role = generateProject(project).find((r) => r.role.id === chipId)!;
		return Object.values(role.files)
			.flatMap((src) => [...src.matchAll(/mesp_web_add\("(\/api\/[^"]*)", HTTP_(GET|POST)/g)])
			.map(([, path, method]) => `${method} ${path}`)
			.sort();
	}
	const documented = (project: ProjectConfig, chipId: string) =>
		apiRoutes(project, chipId)
			.map((r) => `${r.method} ${r.path}`)
			.sort();

	it('documents exactly the routes the firmware registers', () => {
		const project = hubProject();
		const host = chip(project, 'host');
		for (const id of ['ota', 'timers', 'automations', 'otel_metrics'])
			if (!canAddFeature(host, features.get(id), project)) addFeature(host, id);
		expect(Object.keys(host.features)).toContain('otel_metrics');
		expect(documented(project, 'host').length).toBeGreaterThan(20);
		expect(documented(project, 'host')).toEqual(registered(project, 'host'));
	});

	it('has no routes without the HTTP server', () => {
		const project = hubProject();
		expect(apiRoutes(project, 'radio')).toEqual([]);
	});
});
