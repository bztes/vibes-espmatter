/** Automations in words, for the list and the dialog. */
import Gauge from '@lucide/svelte/icons/gauge';
import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
import Repeat from '@lucide/svelte/icons/repeat';
import Timer from '@lucide/svelte/icons/timer';
import { ACTIONS, type ActionDef } from './actions';
import {
	HOLD_COMMANDS,
	daysText,
	endpointName,
	inText,
	onceText,
	presetOf,
	timeText,
	type Action,
	type Choice,
	type Gesture,
	type Scene,
	type Trigger
} from './automations';
import { watchesFor } from './watches';

export type Kind = 'time' | 'once' | 'button' | 'value';
export const KINDS: { id: Kind; title: string; text: string; icon: typeof Repeat }[] = [
	{ id: 'time', title: 'Repeating', text: 'At a time of day, on the days you pick.', icon: Repeat },
	{ id: 'once', title: 'Once', text: 'In a few minutes or at a set date and time.', icon: Timer },
	{
		id: 'button',
		title: 'Button',
		text: 'When a button of a switch or remote is pressed.',
		icon: MousePointerClick
	},
	{
		id: 'value',
		title: 'Sensor',
		text: 'When a sensor value crosses a limit or changes state.',
		icon: Gauge
	}
];

export const GESTURES: { id: Gesture; label: string; short: string }[] = [
	{ id: 'press', label: 'is pressed', short: 'Press' },
	{ id: 'double', label: 'is double-pressed', short: 'Double press' },
	{ id: 'hold', label: 'is held', short: 'Hold' }
];

/** What automations can refer to. */
export interface Lists {
	buttons: Choice[];
	targets: Choice[];
	sensors: Choice[];
	scenes: Scene[];
}

/** With `now`: a one-off says how long until it runs. */
export function whenText(t: Trigger, lists: Lists, now?: number) {
	if (t.type === 'time') return `At ${timeText(t.minute)}, ${daysText(t.days)}`;
	if (t.type === 'once') {
		const left = now !== undefined && t.at > now ? ` (${inText(t.at - now)})` : '';
		return `Once at ${onceText(t.at, now)}${left}`;
	}
	if (t.type === 'button') {
		const g = GESTURES.find((x) => x.id === t.gesture)?.label ?? t.gesture;
		return `When ${endpointName(lists.buttons, t.node, t.endpoint)} ${g}`;
	}
	if (t.type === 'value') {
		const s = lists.sensors.find((x) => x.key === `${t.node}:${t.endpoint}`);
		const device = s?.label ?? `Device ${t.node} · ${t.endpoint}`;
		const w = s && watchesFor(s.ep).find((x) => x.key === t.key);
		const below = t.below !== undefined;
		const held = t.for ? ` for ${Math.round(t.for / 60)} min` : '';
		if (s && w?.kind === 'state') {
			const state = w.states(s.ep).find((x) => (x.cmp === 'below') === below);
			return `When ${device} ${state?.label ?? (below ? 'turns off' : 'turns on')}${held}`;
		}
		const label = s && w ? w.label(s.ep).toLowerCase() : t.key;
		const value = `${t.below ?? t.above}${w?.kind === 'number' ? ` ${w.unit}` : ''}`;
		return `When ${device} ${label} ${below ? 'drops below' : 'rises above'} ${value}${held}`;
	}
	return 'Unknown trigger';
}

export function actionText(a: Action, lists: Lists) {
	if (a.type === 'scene') {
		const s = lists.scenes.find((x) => x.id === a.scene)?.name ?? `scene ${a.scene}`;
		return `${s}: ${a.command}`;
	}
	if (a.type === 'endpoint' || a.type === 'invoke' || a.type === 'write') {
		const device = endpointName(lists.targets, a.node, a.endpoint);
		const p = presetOf(a);
		if (!p) {
			const hold = a.type === 'endpoint' && HOLD_COMMANDS.find((c) => c.id === a.command);
			if (hold) return `${device}: ${hold.label.toLowerCase()}`;
			return a.type === 'write'
				? `${device}: write ${a.value} to attribute ${a.attribute} of cluster ${a.cluster}`
				: `${device}: command ${a.command}${a.type === 'invoke' ? ` of cluster ${a.cluster}` : ''}`;
		}
		const def: ActionDef = ACTIONS[p.id];
		const ep = lists.targets.find((t) => t.key === `${a.node}:${a.endpoint}`)?.ep;
		const prm = ep ? def.param?.(ep) : undefined;
		const value =
			p.arg === undefined
				? ''
				: (prm?.options?.find((o) => o.value === p.arg)?.label ??
					`${p.arg}${prm?.unit ? ` ${prm.unit}` : ''}`);
		return `${device}: ${def.label.toLowerCase()}${value ? ` ${value}` : ''}`;
	}
	return 'unknown action';
}
