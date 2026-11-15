import { describe, expect, it } from 'vitest';
import { assemble } from './assemble';
import { createConfig, enableFeature, normalize, resolve } from './engine';
import { appLink } from './link';

const sources = (config: ReturnType<typeof createConfig>) =>
	assemble(config).firmware[0].sources.map((s) => s.file);

describe('app link', () => {
	it('gives a hub a tunnel and a relay by default', () => {
		const hub = createConfig('hub', 'Hub');
		expect(sources(hub)).toEqual(expect.arrayContaining(['espm_tunnel.cpp', 'espm_hubrelay.cpp']));
		hub.link.relay = false;
		hub.link.access = 'off';
		expect(sources(hub)).not.toContain('espm_tunnel.cpp');
		expect(sources(hub)).not.toContain('espm_hubrelay.cpp');
	});

	it('lets a Wi-Fi device go through its hub', () => {
		const dev = createConfig('device', 'Lamp');
		expect(sources(dev)).toContain('espm_tunnel.cpp');
		dev.link = { updates: 'hub', access: 'hub', relay: false };
		const a = assemble(dev);
		expect(sources(dev)).not.toContain('espm_tunnel.cpp');
		expect(a.firmware[0].defines).toMatchObject({ ESPM_VIA_HUB: true, ESPM_UPDATE_VIA_HUB: true });
		expect(a.firmware[0].components['espressif/mdns']).toBeDefined();
		expect(appLink(a.resolved).direct).toBe(false);
	});

	it('always takes a Thread device through its hub', () => {
		const dev = createConfig('device', 'Sensor');
		enableFeature(dev, 'thread');
		const link = appLink(resolve(dev));
		expect(link).toMatchObject({ updates: 'hub', access: 'hub', direct: false, viaHub: true });
		expect(assemble(dev).firmware[0].defines.ESPM_HUB_OVER_THREAD).toBe(true);
	});

	it('takes the choices over from the former features', () => {
		const hub = normalize({ kind: 'hub', features: { wifi: {}, 'update-relay': {} } });
		expect(hub.link).toEqual({ updates: 'app', access: 'off', relay: true });
		const dev = normalize({ kind: 'device', features: { wifi: {}, 'remote-access': {} } });
		expect(dev.link).toMatchObject({ access: 'tunnel', relay: false });
	});
});
