import type { Story } from '../../stories';
import { anna, api as matterApi, userApi } from '../matter-controller/stories';
import TimersPanel from './device-ui/TimersPanel.svelte';
import { EVERY_DAY, WEEKDAYS, type Timer, type TimersResponse } from './device-ui/timers';

const timer = (t: Partial<Timer> & Pick<Timer, 'id' | 'name'>): Timer => ({
	node: 1,
	endpoint: 1,
	enabled: true,
	days: EVERY_DAY,
	minute: 0,
	action: 'on',
	level: 0,
	mireds: 0,
	fade: 0,
	startLevel: 0,
	startMireds: 0,
	...t
});

const timers: Timer[] = [
	timer({
		id: 1,
		name: 'Wake up',
		days: WEEKDAYS,
		minute: 6 * 60 + 30,
		level: 254,
		mireds: 250,
		fade: 1800,
		startLevel: 1,
		startMireds: 454
	}),
	timer({ id: 2, name: 'Lights out', minute: 23 * 60, action: 'off', fade: 300 }),
	timer({ id: 3, name: 'Coffee off', node: 3, days: 0, remaining: 1260, action: 'off' }),
	timer({
		id: 4,
		name: 'Desk dim',
		node: 2,
		minute: 20 * 60,
		action: 'adjust',
		level: 80,
		enabled: false
	})
];

const response = (
	list: Timer[],
	clock: TimersResponse['clock'] = {
		synced: true,
		tz: 'Europe/Berlin',
		minute: 17 * 60 + 42,
		weekday: 3
	}
): TimersResponse => ({ clock, max: 16, count: list.length, timers: list });

export const api = { ...matterApi, '/api/timers': response(timers) };
export const annasApi = { ...userApi, '/api/timers': response(timers.slice(0, 2)) };

export default [
	{ name: 'Timers', component: TimersPanel, api },
	{ name: 'Timers (user)', component: TimersPanel, api: annasApi, session: anna },
	{
		name: 'Timers (clock not synced)',
		component: TimersPanel,
		api: { ...api, '/api/timers': response(timers, { synced: false, tz: '' }) }
	},
	{ name: 'Timers (none)', component: TimersPanel, api: { ...api, '/api/timers': response([]) } }
] satisfies Story[];
