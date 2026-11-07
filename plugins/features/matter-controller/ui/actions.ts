/**
 * What can be done to an endpoint, per cluster: the dashboard controls send these, automations
 * store them. IDs and field types come from `#sdk/matter` (generated); this adds labels and units.
 */
import {
	ColorControl,
	DoorLock,
	FanControl,
	LevelControl,
	OnOff,
	Thermostat,
	WindowCovering
} from '#sdk/matter';
import {
	FAN_MODES,
	SYSTEM_MODES,
	hasCluster,
	invoke,
	systemModes,
	write,
	type Endpoint
} from './matter';

/** A Matter request: a command with fields (esp-matter's format) or an attribute write. */
export type Op =
	| {
			op: 'invoke';
			cluster: number;
			command: number;
			data?: Record<string, number>;
			timedMs?: number;
	  }
	| { op: 'write'; cluster: number; attribute: number; type: string; value: number | boolean };

interface FieldDef {
	readonly id: number;
	readonly type: string;
	readonly optional?: boolean;
}
interface ClusterDef {
	readonly id: number;
	readonly commands: Record<
		string,
		{ readonly id: number; readonly timed?: boolean; readonly fields: Record<string, FieldDef> }
	>;
	readonly attributes: Record<string, FieldDef>;
}

/** A command; fields not given are 0 (optional ones left out). */
export function command<C extends ClusterDef, K extends keyof C['commands'] & string>(
	cluster: C,
	name: K,
	values: Partial<Record<keyof C['commands'][K]['fields'], number>> = {}
): Op {
	const cmd = cluster.commands[name];
	const given = values as Record<string, number | undefined>;
	const data: Record<string, number> = {};
	for (const [field, f] of Object.entries(cmd.fields))
		if (given[field] !== undefined || !f.optional) data[`${f.id}:${f.type}`] = given[field] ?? 0;
	return {
		op: 'invoke',
		cluster: cluster.id,
		command: cmd.id,
		...(Object.keys(data).length ? { data } : {}),
		...(cmd.timed ? { timedMs: 5000 } : {})
	};
}

export function attribute<C extends ClusterDef>(
	cluster: C,
	name: keyof C['attributes'] & string,
	value: number | boolean
): Op {
	const a = cluster.attributes[name];
	return { op: 'write', cluster: cluster.id, attribute: a.id, type: a.type, value };
}

/** Sends a request to an endpoint. */
export const send = (node: number, endpoint: number, op: Op) =>
	op.op === 'invoke'
		? invoke(node, endpoint, op.cluster, op.command, op.data, op.timedMs)
		: write(node, endpoint, op.cluster, op.attribute, op.type, op.value);

export interface Param {
	label: string;
	min: number;
	max: number;
	step?: number;
	unit?: string;
	/** Instead of a range. */
	options?: { value: number; label: string }[];
	/** Suggested value, e.g. the endpoint's current one. */
	initial: number;
}

export interface ActionDef {
	label: string;
	cluster: number;
	/** The value the user picks, in `param`'s unit. */
	param?: (ep: Endpoint) => Param;
	op: (value: number) => Op;
	/** Missing: every endpoint with the cluster. */
	when?: (ep: Endpoint) => boolean;
}

const kelvin = (mireds: number) => Math.round(1e6 / mireds / 100) * 100;
const STEP = { transitionTime: 3, stepSize: 51 };
const COLOR_STEP = { stepSize: 40, transitionTime: 3 };

/** By ID – the ID is stored with automations, so keep them. */
export const ACTIONS = {
	on: { label: 'Turn on', cluster: OnOff.id, op: () => command(OnOff, 'on') },
	off: { label: 'Turn off', cluster: OnOff.id, op: () => command(OnOff, 'off') },
	toggle: { label: 'Toggle on/off', cluster: OnOff.id, op: () => command(OnOff, 'toggle') },

	level: {
		label: 'Set brightness',
		cluster: LevelControl.id,
		param: (ep) => ({
			label: 'Brightness',
			min: 1,
			max: 100,
			unit: '%',
			initial: ep.level ? Math.round((ep.level / 254) * 100) : 80
		}),
		op: (p) =>
			command(LevelControl, 'moveToLevelWithOnOff', {
				level: Math.max(1, Math.round((p / 100) * 254))
			})
	},
	// StepWithOnOff turns the light on when stepping up; Step down doesn't turn it off.
	brighter: {
		label: 'Brighter (one step)',
		cluster: LevelControl.id,
		op: () =>
			command(LevelControl, 'stepWithOnOff', {
				stepMode: LevelControl.enums.StepModeEnum.up,
				...STEP
			})
	},
	darker: {
		label: 'Darker (one step)',
		cluster: LevelControl.id,
		op: () =>
			command(LevelControl, 'step', { stepMode: LevelControl.enums.StepModeEnum.down, ...STEP })
	},

	colorTemperature: {
		label: 'Set warmth',
		cluster: ColorControl.id,
		when: (ep) => ep.colorTemperature !== undefined,
		param: (ep) => ({
			label: 'Warmth',
			min: kelvin(ep.colorTempMax || 500),
			max: kelvin(ep.colorTempMin || 153),
			step: 100,
			unit: 'K',
			initial: ep.colorTemperature ? kelvin(ep.colorTemperature) : 2700
		}),
		op: (k) =>
			command(ColorControl, 'moveToColorTemperature', {
				colorTemperatureMireds: Math.round(1e6 / k)
			})
	},
	// More mireds = warmer. Min/max 0: the light's own range.
	warmer: {
		label: 'Warmer (one step)',
		cluster: ColorControl.id,
		when: (ep) => ep.colorTemperature !== undefined,
		op: () =>
			command(ColorControl, 'stepColorTemperature', {
				stepMode: ColorControl.enums.StepModeEnum.up,
				...COLOR_STEP
			})
	},
	cooler: {
		label: 'Cooler (one step)',
		cluster: ColorControl.id,
		when: (ep) => ep.colorTemperature !== undefined,
		op: () =>
			command(ColorControl, 'stepColorTemperature', {
				stepMode: ColorControl.enums.StepModeEnum.down,
				...COLOR_STEP
			})
	},

	systemMode: {
		label: 'Set mode',
		cluster: Thermostat.id,
		when: (ep) => ep.systemMode !== undefined,
		param: (ep) => {
			const modes = [...(hasCluster(ep, OnOff.id) ? [] : [0]), ...systemModes(ep)];
			return {
				label: 'Mode',
				min: 0,
				max: 9,
				options: modes.map((m) => ({ value: m, label: SYSTEM_MODES[m] ?? `Mode ${m}` })),
				initial: ep.systemMode ?? modes[0]
			};
		},
		op: (m) => attribute(Thermostat, 'systemMode', m)
	},
	heatingSetpoint: {
		label: 'Heat to',
		cluster: Thermostat.id,
		when: (ep) => ep.heatingSetpoint != null,
		param: (ep) => setpoint(ep.heatingSetpoint, 21),
		op: (c) => attribute(Thermostat, 'occupiedHeatingSetpoint', Math.round(c * 100))
	},
	coolingSetpoint: {
		label: 'Cool to',
		cluster: Thermostat.id,
		when: (ep) => ep.coolingSetpoint != null,
		param: (ep) => setpoint(ep.coolingSetpoint, 24),
		op: (c) => attribute(Thermostat, 'occupiedCoolingSetpoint', Math.round(c * 100))
	},

	fanMode: {
		label: 'Set fan',
		cluster: FanControl.id,
		param: (ep) => ({
			label: 'Fan',
			min: 0,
			max: 6,
			options: FAN_MODES.map((m) => ({ value: Number(m.value), label: m.label })),
			initial: ep.fanMode ?? 5
		}),
		op: (m) => attribute(FanControl, 'fanMode', m)
	},

	lock: { label: 'Lock', cluster: DoorLock.id, op: () => command(DoorLock, 'lockDoor') },
	unlock: { label: 'Unlock', cluster: DoorLock.id, op: () => command(DoorLock, 'unlockDoor') },

	open: {
		label: 'Open',
		cluster: WindowCovering.id,
		op: () => command(WindowCovering, 'upOrOpen')
	},
	close: {
		label: 'Close',
		cluster: WindowCovering.id,
		op: () => command(WindowCovering, 'downOrClose')
	},
	stop: {
		label: 'Stop',
		cluster: WindowCovering.id,
		op: () => command(WindowCovering, 'stopMotion')
	},
	// People think in "how open", Matter in "how closed".
	position: {
		label: 'Open to',
		cluster: WindowCovering.id,
		param: (ep) => ({
			label: 'Open',
			min: 0,
			max: 100,
			unit: '%',
			initial: 100 - Math.round(ep.closedPercent ?? 0)
		}),
		op: (p) =>
			command(WindowCovering, 'goToLiftPercentage', { liftPercent100thsValue: (100 - p) * 100 })
	}
} satisfies Record<string, ActionDef>;

export type ActionId = keyof typeof ACTIONS;

function setpoint(current: number | null | undefined, fallback: number): Param {
	return {
		label: 'Temperature',
		min: 7,
		max: 32,
		step: 0.5,
		unit: '°C',
		initial: current ?? fallback
	};
}

/** The actions an endpoint offers, in table order. */
export const actionsFor = (ep: Endpoint) =>
	(Object.entries(ACTIONS) as [ActionId, ActionDef][]).filter(
		([, a]) => hasCluster(ep, a.cluster) && (!a.when || a.when(ep))
	);
