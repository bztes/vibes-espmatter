/** Actions being edited in the automation dialog. */
import { ACTIONS, actionsFor, type ActionDef, type ActionId, type Param } from './actions';
import { HOLD_COMMANDS, presetOf, splitKey, toAction, type Action } from './automations';
import type { Lists } from './describe';
import { hasCluster, type Endpoint } from './matter';

/** As many as the hub keeps per automation. */
export const MAX_ACTIONS = 12;

export interface Draft {
	id: number;
	type: 'endpoint' | 'scene';
	target: string;
	picked: string;
	/** Undefined: the command's suggestion. */
	pickedArg?: number;
	scene: string;
}

let next = 0;

/** Whether the dialog can show it; the others are kept as they are. */
export const editable = (a: Action) => a.type !== 'unknown';

export function draftOf(a: Action | undefined, lists: Lists): Draft {
	const p = a && presetOf(a);
	const toEp = a?.type === 'endpoint' || a?.type === 'invoke' || a?.type === 'write';
	return {
		id: next++,
		type: a?.type === 'scene' || (!a && !lists.targets.length) ? 'scene' : 'endpoint',
		target: toEp ? `${a.node}:${a.endpoint}` : '',
		picked: p?.id ?? (a?.type === 'endpoint' ? a.command : 'on'),
		pickedArg: p?.arg,
		scene: a?.type === 'scene' ? String(a.scene) : ''
	};
}

export interface Resolved {
	ep?: Endpoint;
	available: { id: string; label: string }[];
	/** The picked command, or the first available one when trigger or device rule it out. */
	command: string;
	param?: Param;
	arg?: number;
	/** Missing: not filled in yet. */
	action?: Action;
}

/** `held`: the trigger is a held button, which offers the "while held" commands. */
export function resolve(d: Draft, lists: Lists, held: boolean): Resolved {
	if (d.type === 'scene')
		return {
			available: [],
			command: '',
			action: d.scene ? { type: 'scene', scene: Number(d.scene), command: 'activate' } : undefined
		};
	const ep = lists.targets.find((t) => t.key === d.target)?.ep;
	const available = ep
		? [
				...actionsFor(ep).map(([id, a]) => ({ id: id as string, label: a.label })),
				...(held ? HOLD_COMMANDS.filter((c) => hasCluster(ep, c.cluster)) : [])
			]
		: [];
	const command = available.some((c) => c.id === d.picked) ? d.picked : (available[0]?.id ?? '');
	const preset = command in ACTIONS ? (command as ActionId) : undefined;
	const def: ActionDef | undefined = preset && ACTIONS[preset];
	const param = ep ? def?.param?.(ep) : undefined;
	const arg = d.pickedArg ?? param?.initial;
	let action: Action | undefined;
	if (ep && command) {
		const [node, endpoint] = splitKey(d.target);
		action = preset
			? toAction(node, endpoint, preset, param ? arg : undefined)
			: { type: 'endpoint', node, endpoint, command };
	}
	return { ep, available, command, param, arg, action };
}
