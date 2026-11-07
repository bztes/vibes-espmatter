/** Automations and scenes of the hub (`/api/v1/controller/automations`, `/api/v1/controller/scenes`). */
import { ACTIONS, actionsFor, type ActionDef, type ActionId, type Op } from './actions';
import type { SelectGroup } from '#sdk/device-ui';
import { CLUSTER, hasCluster, typeName, type Endpoint, type Node } from './matter';

export type Gesture = 'press' | 'double' | 'hold';

export type Trigger =
	| { type: 'button'; node: number; endpoint: number; gesture: Gesture }
	| { type: 'time'; minute: number; days: number }
	| { type: 'once'; at: number }
	/** `for`: s the condition must hold. */
	| {
			type: 'value';
			node: number;
			endpoint: number;
			key: string;
			below?: number;
			above?: number;
			hysteresis?: number;
			for?: number;
	  }
	| { type: 'unknown' };

/** `preset` and `arg`: which entry of `ACTIONS` it came from, with the value picked. */
interface Request {
	node: number;
	endpoint: number;
	cluster: number;
	timedMs?: number;
	preset?: string;
	arg?: number;
}

export type Action =
	/** Built into the hub: the "while held" commands, and rules made before `invoke`/`write`. */
	| { type: 'endpoint'; node: number; endpoint: number; command: string; level?: number }
	| (Request & { type: 'invoke'; command: number; data?: Record<string, number> })
	| (Request & { type: 'write'; attribute: number; valueType: string; value: number | boolean })
	| { type: 'scene'; scene: number; command: 'activate' }
	| { type: 'unknown' };

/** Commands the hub runs while a button is held, and stops on release. */
export const HOLD_COMMANDS = [
	{ id: 'dim_up', label: 'Brighter while held', cluster: CLUSTER.levelControl },
	{ id: 'dim_down', label: 'Darker while held', cluster: CLUSTER.levelControl },
	{ id: 'warmer_hold', label: 'Warmer while held', cluster: CLUSTER.colorControl },
	{ id: 'cooler_hold', label: 'Cooler while held', cluster: CLUSTER.colorControl }
];

export function toAction(node: number, endpoint: number, id: ActionId, arg?: number): Action {
	const def: ActionDef = ACTIONS[id];
	const op: Op = def.op(arg ?? 0);
	const timedMs = op.op === 'invoke' ? op.timedMs : undefined;
	const base = { node, endpoint, cluster: op.cluster, timedMs, preset: id };
	const withArg = def.param && arg !== undefined ? { arg } : {};
	return op.op === 'invoke'
		? { type: 'invoke', ...base, ...withArg, command: op.command, data: op.data }
		: {
				type: 'write',
				...base,
				...withArg,
				attribute: op.attribute,
				valueType: op.type,
				value: op.value
			};
}

/** The `ACTIONS` entry and value behind an action – also for rules from before presets. */
export function presetOf(a: Action): { id: ActionId; arg?: number } | undefined {
	if ((a.type === 'invoke' || a.type === 'write') && a.preset && a.preset in ACTIONS)
		return { id: a.preset as ActionId, arg: a.arg };
	if (a.type === 'endpoint' && a.command in ACTIONS)
		return {
			id: a.command as ActionId,
			arg: a.command === 'level' && a.level ? levelToPercent(a.level) : undefined
		};
}

export interface Rule {
	id: number;
	name: string;
	enabled: boolean;
	owner: string;
	mine: boolean;
	active: boolean;
	problem?: string;
	trigger: Trigger;
	actions: Action[];
}

export interface Clock {
	synced: boolean;
	minute?: number;
	weekday?: number;
	zone?: string;
	/** Unix time. */
	now?: number;
}

export interface Member {
	node: number;
	endpoint: number;
	on: boolean;
	level?: number;
	colorTemperature?: number;
}

export interface Scene {
	id: number;
	name: string;
	owner: string;
	mine: boolean;
	/** `read`: may only run it (granted by an admin). */
	access: 'read' | 'write';
	active: boolean;
	members: Member[];
}

/** An endpoint to pick: "<device>" or "<device> · <word> <n>" when it has several. */
export interface Choice {
	key: string;
	node: Node;
	ep: Endpoint;
	label: string;
}

/** Admins get no `access`: everything. */
export const canWrite = (ep: Endpoint) => !ep.access || ep.access === 'write';

export function endpointsWith(
	nodes: Node[],
	cluster: number,
	word: string,
	writable = false
): Choice[] {
	return nodes.flatMap((node) => {
		const eps = node.endpoints.filter(
			(ep) => hasCluster(ep, cluster) && (!writable || canWrite(ep))
		);
		return eps.map((ep) => ({
			key: `${node.id}:${ep.id}`,
			node,
			ep,
			label: eps.length > 1 ? `${node.name} · ${word} ${ep.id}` : node.name
		}));
	});
}

export const splitKey = (key: string) => key.split(':').map(Number) as [number, number];

/** Endpoints a scene can switch. */
export const switchables = (nodes: Node[]) => endpointsWith(nodes, CLUSTER.onOff, 'endpoint', true);

/** Endpoints an automation can control. */
export function controllables(nodes: Node[]): Choice[] {
	return nodes.flatMap((node) => {
		const eps = node.endpoints.filter((ep) => canWrite(ep) && actionsFor(ep).length);
		return eps.map((ep) => ({
			key: `${node.id}:${ep.id}`,
			node,
			ep,
			label: eps.length > 1 ? `${node.name} · endpoint ${ep.id}` : node.name
		}));
	});
}

/** For a combobox: by the device's first tag (its room, usually), untagged ones last. */
export function deviceGroups(list: Choice[]): SelectGroup[] {
	const tagged = list.some((c) => c.node.tags?.length);
	const groups: SelectGroup[] = [];
	for (const c of list) {
		const label = tagged ? (c.node.tags?.[0] ?? 'Other') : '';
		let g = groups.find((x) => x.label === label);
		if (!g) groups.push((g = { label, options: [] }));
		g.options.push({
			value: c.key,
			label: c.label,
			description: typeName(c.ep) || c.node.product,
			warning: c.node.online ? undefined : 'Offline right now'
		});
	}
	return groups.sort((a, b) => +(a.label === 'Other') - +(b.label === 'Other'));
}

export function endpointName(list: Choice[], node: number, endpoint: number) {
	return list.find((c) => c.key === `${node}:${endpoint}`)?.label ?? `Device ${node} · ${endpoint}`;
}

/** Sunday first, as the hub counts (bit 0). */
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const EVERY_DAY = 0x7f;
export const WORKDAYS = 0x3e;
export const WEEKEND = 0x41;

export function daysText(days: number) {
	if (days === EVERY_DAY) return 'every day';
	if (days === WORKDAYS) return 'Mon–Fri';
	if (days === WEEKEND) return 'Sat and Sun';
	// Monday first for reading.
	return [1, 2, 3, 4, 5, 6, 0]
		.filter((d) => days & (1 << d))
		.map((d) => WEEKDAYS[d])
		.join(', ');
}

export const timeText = (minute: number) =>
	`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

export const percentToLevel = (pct: number) => Math.max(1, Math.round((pct * 254) / 100));
export const levelToPercent = (level: number) => Math.round((level * 100) / 254);

/** "14:30", "Fri 14:30" within a week, else the date too – in the browser's time zone. */
export function onceText(at: number, now = Date.now() / 1000) {
	const d = new Date(at * 1000);
	const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	if (d.toDateString() === new Date(now * 1000).toDateString()) return time;
	if (Math.abs(at - now) < 6 * 86400)
		return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
	return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} ${time}`;
}

/** "in 8 min", "in 2 h 5 min". */
export function inText(seconds: number) {
	const min = Math.max(1, Math.ceil(seconds / 60));
	if (min < 60) return `in ${min} min`;
	const h = Math.floor(min / 60);
	return `in ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

/** Local date (for `<input type="date">`) and minute of the day. */
export function localParts(at: number) {
	const d = new Date(at * 1000);
	const p = (n: number) => String(n).padStart(2, '0');
	return {
		day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
		minute: d.getHours() * 60 + d.getMinutes()
	};
}

/** Unix time of a local date and minute of the day. */
export const fromLocal = (day: string, minute: number) =>
	Math.floor(new Date(`${day}T${timeText(minute)}`).getTime() / 1000);
