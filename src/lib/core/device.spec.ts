import { describe, expect, it } from 'vitest';
import { assemble } from './assemble';
import { deviceEntries, effectiveConfig, normalizeDevice } from './device';
import { addPeripheral, createConfig, enableFeature } from './engine';
import { generate } from './generate';
import { validate, validateDevice } from './validate';

const identity = { id: 'dev-1', name: 'Kitchen', apiToken: 'tok', appUrl: 'http://app:5173' };

describe('per-device settings', () => {
	it('are read at runtime, not compiled in', () => {
		const fw = createConfig('device', 'Sensors');
		fw.features.wifi.ssid = 'Home';
		const relay = addPeripheral(fw, 'relay');
		const [main] = generate(assemble(fw), (ref) => `// ${ref.file}`);
		const header = main.files['main/espm_config.h'];
		expect(header).toContain('#include "espm_cfg.h"');
		expect(header).toContain('#define ESPM_WIFI_SSID (espm_cfg_str("f.wifi", "ssid", "Home"))');
		expect(header).toContain('#define ESPM_API_TOKEN (espm_cfg_str("espm", "token", ""))');
		expect(header).toContain('#define ESPM_UPDATE_PULL 1');
		// Pins stay compiled in, the startup state is the device's.
		expect(main.files['main/app_main.cpp']).toContain(
			`espm_cfg_str("p.${relay.uid}", "startup", "last")`
		);
		expect(main.files['main/app_main.cpp']).toContain(`, ${relay.settings.gpio}, true,`);
	});

	it('come from the device, then the firmware', async () => {
		const fw = createConfig('device', 'Sensors');
		fw.features.wifi.ssid = 'Firmware';
		const climate = addPeripheral(fw, 'climate-sensor');
		const dev = normalizeDevice(
			{ plugins: { [`peripheral:${climate.uid}`]: { offset: '-1.5', bogus: 1 } } },
			fw
		);
		expect(dev.plugins[`peripheral:${climate.uid}`]).toEqual({ offset: -1.5 });
		fw.features.wifi.password = 'secret123';
		const eff = effectiveConfig(fw, dev, 'Kitchen');
		expect(eff.name).toBe('Kitchen');
		expect(eff.features.wifi).toMatchObject({ ssid: 'Firmware', password: 'secret123' });
		expect(eff.peripherals[0].settings.offset).toBe(-1.5);
		expect(fw.features.wifi.ssid).toBe('Firmware');

		dev.plugins['feature:wifi'] = { ssid: 'Own' };
		const { entries, rev } = await deviceEntries(fw, dev, identity);
		const get = (ns: string, key: string) =>
			entries.find((e) => e.ns === ns && e.key === key)?.value;
		expect(get('f.wifi', 'ssid')).toBe('Own');
		expect(get('f.wifi', 'password')).toBe('secret123');
		expect(get(`p.${climate.uid}`, 'offset')).toBe(-1.5);
		expect(get('espm', 'token')).toBe('tok');
		expect(get('espm', 'app_url')).toBe('http://app:5173');
		expect(get('espm', 'rev')).toBe(rev);
		expect(rev).toMatch(/^[0-9a-f]{12}$/);
		// Same input, same revision; another value, another one.
		expect((await deviceEntries(fw, dev, identity)).rev).toBe(rev);
		dev.updates.intervalMin = 30;
		expect((await deviceEntries(fw, dev, identity)).rev).not.toBe(rev);
	});

	it('are validated per device', () => {
		const fw = createConfig('device', 'Sensors');
		addPeripheral(fw, 'contact-sensor');
		enableFeature(fw, 'otel');
		// The firmware may leave the endpoint to its devices …
		expect(validate(fw).some((i) => i.field === 'endpoint')).toBe(false);
		// … a device needs one.
		const dev = normalizeDevice({}, fw);
		expect(validateDevice(fw, dev, 'Door').map((i) => i.field)).toContain('endpoint');
		dev.plugins['feature:otel'] = { endpoint: 'http://collector:4318' };
		expect(validateDevice(fw, dev, 'Door').map((i) => i.field)).toEqual(['uiPasswordHash']);
		dev.uiPasswordHash = `pbkdf2-sha256$2000$${'ab'.repeat(16)}$${'cd'.repeat(32)}`;
		expect(validateDevice(fw, dev, 'Door')).toEqual([]);
	});

	it('get new Matter codes per device, and keep only password hashes', () => {
		const a = normalizeDevice({});
		const b = normalizeDevice({});
		expect(a.matter).not.toEqual(b.matter);
		expect(a.uiPasswordHash).toBe('');
		const hash = `pbkdf2-sha256$2000$${'ab'.repeat(16)}$${'cd'.repeat(32)}`;
		expect(normalizeDevice({ uiPasswordHash: hash }).uiPasswordHash).toBe(hash);
		expect(normalizeDevice({ uiPasswordHash: 'secret123' }).uiPasswordHash).toBe('');
		expect(normalizeDevice({ uiPassword: 'secret123' })).not.toHaveProperty('uiPassword');
		expect(normalizeDevice({ matter: { passcode: 11111111 } }).matter.passcode).not.toBe(11111111);
	});
});
