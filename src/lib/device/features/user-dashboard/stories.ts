import type { Story } from '../../stories';
import { anna } from '../matter-controller/stories';
import TilesPanel from '../matter-controller/device-ui/TilesPanel.svelte';
import { annasApi as annasScenesApi, api as scenesApi } from '../scenes/stories';
import ScenesPanel from '../scenes/device-ui/ScenesPanel.svelte';
import { annasApi as annasTimersApi, api as timersApi } from '../timers/stories';
import TimersPanel from '../timers/device-ui/TimersPanel.svelte';
import { device } from '../web-ui/stories';
import DashboardLayout from './device-ui/DashboardLayout.svelte';

const props = {
	device,
	page: 'dashboard',
	panels: [
		{ id: 'tiles', title: 'Devices', component: TilesPanel },
		{ id: 'scenes', title: 'Scenes', component: ScenesPanel },
		{ id: 'timers', title: 'Timers', component: TimersPanel }
	].map((p) => ({ ...p, area: 'main', section: 'system', props: {} }))
};

export default [
	{
		name: 'Dashboard',
		component: DashboardLayout,
		props,
		api: { ...scenesApi, ...timersApi },
		wide: true
	},
	{
		name: 'Dashboard (user)',
		component: DashboardLayout,
		props,
		api: { ...annasScenesApi, ...annasTimersApi },
		session: anna,
		wide: true
	}
] satisfies Story[];
