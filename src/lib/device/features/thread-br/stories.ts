import type { Story } from '../../stories';
import ThreadPanel from './device-ui/ThreadPanel.svelte';

const neighbor = (n: number, child: boolean, rssi: number) => ({
	extAddress: `1a2b3c4d5e6f70${n.toString(16).padStart(2, '0')}`,
	rloc16: child ? `0x${(0x4400 + n).toString(16)}` : `0x${(n << 10).toString(16)}`,
	child,
	ftd: !child,
	rxOnWhenIdle: !child,
	rssi,
	lqi: rssi > -70 ? 3 : 2,
	age: n * 7
});

export const api = {
	'/api/thread': {
		radio: 'ready',
		initialized: true,
		role: 'leader',
		commissioned: true,
		networkName: 'ESPMatter-1F2E',
		channel: 15,
		panId: '0x1f2e',
		extPanId: 'dead00beef00cafe',
		rloc16: '0x4400',
		extAddress: 'a1b2c3d4e5f60718',
		partitionId: 1_234_567_890,
		leaderRouterId: 17,
		omrPrefix: 'fd5f:2a1b:9c3d:1::/64',
		neighbors: [neighbor(1, false, -52), neighbor(2, true, -64), neighbor(3, true, -78)]
	}
};

export default [
	{ name: 'Leader', component: ThreadPanel, api },
	{
		name: 'Detached',
		component: ThreadPanel,
		api: { '/api/thread': { ...api['/api/thread'], role: 'detached', neighbors: [] } }
	},
	{
		name: 'Radio starting',
		component: ThreadPanel,
		api: { '/api/thread': { radio: 'starting', initialized: false } }
	},
	{
		name: 'No radio',
		component: ThreadPanel,
		api: { '/api/thread': { radio: 'waiting', initialized: false } }
	}
] satisfies Story[];
