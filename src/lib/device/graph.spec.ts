import { describe, expect, it } from 'vitest';
import { defaultProject } from './generator';
import { dependencyGraph } from './graph';

describe('dependency graph', () => {
	it('links what relies on what, within and between boards', () => {
		const { nodes, edges } = dependencyGraph(defaultProject('matter-hub'));
		const depth = (key: string) => nodes.find((n) => n.key === key)?.depth;
		const has = (from: string, to: string, kind: string) =>
			edges.some((e) => e.from === from && e.to === to && e.kind === kind);

		// device and Wi-Fi rely on nothing; the dashboards sit on top of the HTTP server
		expect(depth('host:device')).toBe(0);
		expect(depth('host:wifi')).toBe(0);
		expect(depth('host:user_dashboard')!).toBeGreaterThan(depth('host:http_server')!);
		expect(has('host:user_dashboard', 'host:admin_dashboard', 'requires')).toBe(false);
		// timers and automations only bring panels to the dashboards: they don't need them
		expect(has('host:timers', 'host:user_dashboard', 'requires')).toBe(false);
		expect(has('host:automations', 'host:admin_dashboard', 'requires')).toBe(false);
		// … but work with them when they are there
		expect(has('host:timers', 'host:user_dashboard', 'soft')).toBe(true);
		expect(has('host:automations', 'host:admin_dashboard', 'soft')).toBe(true);
		// a requirement is not also a soft dependency
		expect(has('host:ota', 'host:http_server', 'soft')).toBe(false);

		expect(has('host:ota', 'host:http_server', 'requires')).toBe(true);
		// between boards: the border router talks to the radio
		expect(has('host:thread_br', 'radio:openthread_rcp', 'link')).toBe(true);
	});
});
