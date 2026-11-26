import { describe, expect, it } from 'vitest';
import { assemble } from './assemble';
import { boardSettings, deviceEntries, effectiveConfig, normalizeDevice } from './device';
import { addPeripheral, createConfig, enableFeature } from './engine';
import { generate } from './generate';
import { nvsImage, readNvs } from './nvs';
import { validate, validateDevice } from './validate';

const identity = { id: 'dev-1', name: 'Kitchen', apiToken: 'tok', appUrl: 'http://app:5173' };

describe('per-device settings', () => {
	it('are read at runtime, not compiled in', () => {
		const fw = createConfig('device', 'Sensors');
		const relay = addPeripheral(fw, 'relay');
		// The firmware has no values for them.
		expect(fw.features.wifi).not.toHaveProperty('ssid');
		expect(relay.settings).not.toHaveProperty('startup');
		const [main] = generate(assemble(fw), (ref) => `// ${ref.file}`);
		const header = main.files['main/espm_config.h'];
		expect(header).toContain('#include "espm_cfg.h"');
		expect(header).toContain('#define ESPM_WIFI_SSID (espm_cfg_str("f.wifi", "ssid", ""))');
		expect(header).toContain('#define ESPM_API_TOKEN (espm_cfg_str("espm", "token", ""))');
		expect(header).toContain('#define ESPM_MATTER_OTA 1');
		// Pins stay compiled in, the startup state is the device's.
		expect(main.files['main/app_main.cpp']).toContain(
			`espm_cfg_str("p.${relay.uid}", "startup", "last")`
		);
		expect(main.files['main/app_main.cpp']).toContain(`, ${relay.settings.gpio}, true,`);
	});

	it('all come from the device', () => {
		const fw = createConfig('device', 'Sensors');
		const climate = addPeripheral(fw, 'climate-sensor');
		const dev = normalizeDevice(
			{
				plugins: {
					[`peripheral:${climate.uid}`]: { offset: '-1.5', bogus: 1 },
					'feature:gone': { x: 1 }
				}
			},
			fw
		);
		expect(dev.plugins[`peripheral:${climate.uid}`]).toEqual({ interval: 30, offset: -1.5 });
		expect(dev.plugins['feature:wifi']).toEqual({ ssid: '', password: '', powerSave: 'min' });
		expect(dev.plugins).not.toHaveProperty('feature:gone');
		dev.plugins['feature:wifi'].ssid = 'Own';
		const eff = effectiveConfig(fw, dev, 'Kitchen');
		expect(eff.name).toBe('Kitchen');
		expect(eff.features.wifi.ssid).toBe('Own');
		expect(eff.peripherals[0].settings.offset).toBe(-1.5);
		expect(fw.features.wifi).not.toHaveProperty('ssid');

		const entries = deviceEntries(fw, dev, identity);
		const get = (ns: string, key: string) =>
			entries.find((e) => e.ns === ns && e.key === key)?.value;
		expect(get('f.wifi', 'ssid')).toBe('Own');
		expect(get('f.wifi', 'password')).toBe('');
		expect(get(`p.${climate.uid}`, 'offset')).toBe(-1.5);
		expect(get('espm', 'token')).toBe('tok');
		expect(get('espm', 'app_url')).toBe('http://app:5173');

		// Read back from the board: the same settings; the server's app URL stays the default.
		const back = boardSettings(readNvs(nvsImage(entries, 0x4000)), fw, identity.appUrl);
		expect(back.id).toBe('dev-1');
		expect(back.settings).toEqual(dev);
	});

	it('are validated per device', () => {
		const fw = createConfig('device', 'Sensors');
		addPeripheral(fw, 'contact-sensor');
		enableFeature(fw, 'otel');
		// The firmware has no endpoint …
		expect(validate(fw).some((i) => i.field === 'endpoint')).toBe(false);
		// … a device needs one.
		const dev = normalizeDevice({}, fw);
		expect(validateDevice(fw, dev, 'Door').map((i) => i.field)).toContain('endpoint');
		dev.plugins['feature:otel'].endpoint = 'http://collector:4318';
		expect(validateDevice(fw, dev, 'Door').map((i) => i.field)).toEqual(['uiPasswordHash']);
		dev.uiPasswordHash = `pbkdf2-sha256$2000$${'ab'.repeat(16)}$${'cd'.repeat(32)}`;
		expect(validateDevice(fw, dev, 'Door')).toEqual([]);
	});

	it('get new Matter codes per device, and keep only password hashes', () => {
		const fw = createConfig('device');
		const norm = (raw: unknown) => normalizeDevice(raw, fw);
		const a = norm({});
		const b = norm({});
		expect(a.matter).not.toEqual(b.matter);
		expect(a.uiPasswordHash).toBe('');
		const hash = `pbkdf2-sha256$2000$${'ab'.repeat(16)}$${'cd'.repeat(32)}`;
		expect(norm({ uiPasswordHash: hash }).uiPasswordHash).toBe(hash);
		expect(norm({ uiPasswordHash: 'secret123' }).uiPasswordHash).toBe('');
		expect(norm({ uiPassword: 'secret123' })).not.toHaveProperty('uiPassword');
		expect(norm({ matter: { passcode: 11111111 } }).matter.passcode).not.toBe(11111111);
	});
});
