/**
 * What a value trigger can watch: the attributes the hub follows (by their API key), as a number
 * against a threshold or as a state that changes. The hub only compares numbers.
 */
import { DEVICE_TYPE } from '#sdk/matter';
import { CLUSTER, hasCluster, is, type Endpoint, type Node } from './matter';
import { canWrite, type Choice } from './automations';

export type Cmp = 'below' | 'above';

interface Base {
	key: keyof Endpoint & string;
	cluster: number;
	label: (ep: Endpoint) => string;
}
export interface NumberWatch extends Base {
	kind: 'number';
	unit: string;
	min: number;
	max: number;
	step: number;
	/** How far back past the threshold before it can fire again. */
	hysteresis: number;
	initial: number;
}
export interface StateWatch extends Base {
	kind: 'state';
	/** Booleans are 0/1: a state is "below 0.5" or "above 0.5". */
	states: (ep: Endpoint) => { label: string; cmp: Cmp }[];
}
export type Watch = NumberWatch | StateWatch;

const temperature = (key: Base['key'], cluster: number, label: string, initial = 18): Watch => ({
	kind: 'number',
	key,
	cluster,
	label: () => label,
	unit: '°C',
	min: -30,
	max: 50,
	step: 0.5,
	hysteresis: 0.5,
	initial
});

export const WATCHES: Watch[] = [
	temperature('temperature', CLUSTER.temperatureMeasurement, 'Temperature'),
	temperature('localTemperature', CLUSTER.thermostat, 'Room temperature'),
	temperature('outdoorTemperature', CLUSTER.thermostat, 'Outside temperature', 0),
	{
		kind: 'number',
		key: 'humidity',
		cluster: CLUSTER.relativeHumidityMeasurement,
		label: () => 'Humidity',
		unit: '%',
		min: 0,
		max: 100,
		step: 1,
		hysteresis: 3,
		initial: 60
	},
	{
		kind: 'number',
		key: 'illuminance',
		cluster: CLUSTER.illuminanceMeasurement,
		label: () => 'Light',
		unit: 'lx',
		min: 0,
		max: 5000,
		step: 10,
		hysteresis: 20,
		initial: 50
	},
	{
		kind: 'number',
		key: 'pressure',
		cluster: CLUSTER.pressureMeasurement,
		label: () => 'Pressure',
		unit: 'hPa',
		min: 900,
		max: 1100,
		step: 1,
		hysteresis: 1,
		initial: 1000
	},
	{
		kind: 'number',
		key: 'power',
		cluster: CLUSTER.electricalPowerMeasurement,
		label: () => 'Power',
		unit: 'W',
		min: 0,
		max: 10000,
		step: 1,
		hysteresis: 5,
		initial: 10
	},
	// Boolean State: what `true` means depends on the device type.
	{
		kind: 'state',
		key: 'stateValue',
		cluster: CLUSTER.booleanState,
		label: (ep) =>
			is(ep, DEVICE_TYPE.contactSensor)
				? 'Contact'
				: is(ep, DEVICE_TYPE.waterLeakDetector)
					? 'Water'
					: 'State',
		states: (ep) =>
			is(ep, DEVICE_TYPE.contactSensor)
				? [
						{ label: 'opens', cmp: 'below' },
						{ label: 'closes', cmp: 'above' }
					]
				: is(ep, DEVICE_TYPE.waterLeakDetector)
					? [
							{ label: 'detects a leak', cmp: 'above' },
							{ label: 'is dry again', cmp: 'below' }
						]
					: [
							{ label: 'turns on', cmp: 'above' },
							{ label: 'turns off', cmp: 'below' }
						]
	},
	{
		kind: 'state',
		key: 'occupied',
		cluster: CLUSTER.occupancySensing,
		label: () => 'Occupancy',
		states: () => [
			{ label: 'detects someone', cmp: 'above' },
			{ label: 'is clear', cmp: 'below' }
		]
	},
	{
		kind: 'state',
		key: 'on',
		cluster: CLUSTER.onOff,
		label: () => 'Power',
		states: () => [
			{ label: 'is switched on', cmp: 'above' },
			{ label: 'is switched off', cmp: 'below' }
		]
	}
];

/** What the endpoint reports (a missing key: it doesn't have that attribute). */
export const watchesFor = (ep: Endpoint) =>
	WATCHES.filter((w) => hasCluster(ep, w.cluster) && ep[w.key] !== undefined);

export const STATE_THRESHOLD = 0.5;

/** Endpoints a value trigger can watch: readable ones that report something to watch. */
export function sensors(nodes: Node[]): Choice[] {
	return nodes.flatMap((node) => {
		const eps = node.endpoints.filter(
			(ep) => (canWrite(ep) || ep.access === 'read') && watchesFor(ep).length
		);
		return eps.map((ep) => ({
			key: `${node.id}:${ep.id}`,
			node,
			ep,
			label: eps.length > 1 ? `${node.name} · endpoint ${ep.id}` : node.name
		}));
	});
}
