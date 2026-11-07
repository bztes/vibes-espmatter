/**
 * What the hub reports about paired devices (`GET /api/v1/controller/nodes`) and the Matter
 * commands/writes the dashboard sends. Cluster and device type IDs come from `#sdk/matter`.
 */
import { api } from '#sdk/device-ui';
import { CLUSTER, DEVICE_TYPE, deviceTypeName, isUtility } from '#sdk/matter';

export { CLUSTER };

/** What a user (not admin) may do; missing for admins. */
export type Access = 'none' | 'read' | 'write';

export interface Endpoint {
	id: number;
	access?: Access;
	/** What the endpoint is. */
	deviceTypes: number[];
	/** What it can do: its server clusters. Missing from hubs with older firmware. */
	clusters?: number[];
	on?: boolean | null;
	/** 1–254. */
	level?: number | null;
	/** Color Control ColorTemperatureMireds (1,000,000 / K); missing without tunable white. */
	colorTemperature?: number | null;
	/** Coolest (min mireds) and warmest (max mireds) the light can do. */
	colorTempMin?: number | null;
	colorTempMax?: number | null;
	/** Window covering, 0 (open) – 100 (closed). */
	closedPercent?: number | null;
	/** 0 not fully locked, 1 locked, 2 unlocked, 3 unlatched. */
	lockState?: number | null;
	localTemperature?: number | null;
	/** Thermostat OutdoorTemperature (optional attribute), °C. */
	outdoorTemperature?: number | null;
	/** Thermostat SystemMode: 0 off, 1 auto, 3 cool, 4 heat, 7 fan, 8 dry … */
	systemMode?: number | null;
	heatingSetpoint?: number | null;
	coolingSetpoint?: number | null;
	controlSequence?: number | null;
	/** FanControl FanMode: 0 off, 1 low, 2 medium, 3 high, 5 auto. */
	fanMode?: number | null;
	temperature?: number | null;
	humidity?: number | null;
	/** BooleanState, e.g. contact sensor: true = closed. */
	stateValue?: boolean | null;
	occupied?: boolean | null;
	/** lx. */
	illuminance?: number | null;
	/** hPa. */
	pressure?: number | null;
	/** Electrical Power Measurement ActivePower, W. */
	power?: number | null;
	/** Electrical Energy Measurement CumulativeEnergyImported, kWh. */
	energy?: number | null;
	/** Generic Switch FeatureMap: 0x10 multi-press (double press), 0x20 action switch. */
	switchFeatures?: number | null;
}

export interface Node {
	id: number;
	name: string;
	/** The device's own grant (its endpoints may have their own). */
	access?: Access;
	state: 'connecting' | 'online' | 'offline';
	online: boolean;
	/** Read every minute while online, if the device has the diagnostics clusters. */
	diagnostics?: {
		/** s */
		uptime?: number;
		rebootCount?: number;
		/** Bytes. */
		heapFree?: number;
		heapHighWatermark?: number;
	};
	/** Set by admins; the dashboard can group by them. Missing from older firmware. */
	tags?: string[];
	vendor?: string;
	product?: string;
	softwareVersion?: string;
	/** Battery-powered devices: %, and/or the coarse level. */
	battery?: number;
	batteryLevel?: 'ok' | 'warning' | 'critical';
	/** s since the device last reported anything; missing: not since the hub started. */
	lastSeenAgo?: number;
	/** Unix time of that, once the hub's clock is set. */
	lastSeen?: number;
	endpoints: Endpoint[];
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(seconds: number): string {
	if (seconds < 60) return 'just now';
	if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
	const d = Math.floor(seconds / 86400);
	return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** All tags of the given devices, sorted. */
export const allTags = (nodes: Node[]) =>
	[...new Set(nodes.flatMap((n) => n.tags ?? []))].sort((a, b) => a.localeCompare(b));

/** Rename a device and/or replace its tags (admins). */
export function updateNode(id: number, changes: { name?: string; tags?: string[] }) {
	return api(`/api/v1/controller/nodes/${id}`, { method: 'PUT', body: changes });
}

/** Send a cluster command; `data` in esp-matter's format, e.g. `{"0:U8": 4}`. */
export function invoke(
	node: number,
	endpoint: number,
	cluster: number,
	command: number,
	data?: Record<string, number>,
	timedMs?: number
) {
	return api('/api/v1/controller/invoke', {
		body: { node, endpoint, cluster, command, data, timedMs }
	});
}

/** Write an attribute; `type` is the TLV type, e.g. `U8` or `I16`. */
export function write(
	node: number,
	endpoint: number,
	cluster: number,
	attribute: number,
	type: string,
	value: number | boolean
) {
	return api('/api/v1/controller/write', {
		body: { node, endpoint, cluster, attribute, type, value }
	});
}

export const typeName = (ep: Endpoint) =>
	ep.deviceTypes
		.filter((t) => !isUtility(t))
		.map(deviceTypeName)
		.join(', ');

export const is = (ep: Endpoint, type: number) => ep.deviceTypes.includes(type);

/** For hubs that don't report `clusters` yet: the clusters behind the reported attributes. */
const ATTRIBUTE_CLUSTERS: [keyof Endpoint, number][] = [
	['on', CLUSTER.onOff],
	['level', CLUSTER.levelControl],
	['colorTemperature', CLUSTER.colorControl],
	['closedPercent', CLUSTER.windowCovering],
	['lockState', CLUSTER.doorLock],
	['localTemperature', CLUSTER.thermostat],
	['outdoorTemperature', CLUSTER.thermostat],
	['systemMode', CLUSTER.thermostat],
	['heatingSetpoint', CLUSTER.thermostat],
	['coolingSetpoint', CLUSTER.thermostat],
	['fanMode', CLUSTER.fanControl],
	['temperature', CLUSTER.temperatureMeasurement],
	['humidity', CLUSTER.relativeHumidityMeasurement],
	['stateValue', CLUSTER.booleanState],
	['occupied', CLUSTER.occupancySensing],
	['illuminance', CLUSTER.illuminanceMeasurement],
	['pressure', CLUSTER.pressureMeasurement],
	['power', CLUSTER.electricalPowerMeasurement],
	['energy', CLUSTER.electricalEnergyMeasurement]
];

/** The server clusters of an endpoint. */
export const clustersOf = (ep: Endpoint): number[] =>
	ep.clusters ?? [...new Set(ATTRIBUTE_CLUSTERS.filter(([key]) => key in ep).map(([, c]) => c))];

export const hasCluster = (ep: Endpoint, cluster: number) => clustersOf(ep).includes(cluster);

/** Thermostat SystemMode values. */
export const SYSTEM_MODES: Record<number, string> = {
	0: 'Off',
	1: 'Auto',
	3: 'Cool',
	4: 'Heat',
	5: 'Emergency heat',
	6: 'Precooling',
	7: 'Fan',
	8: 'Dry',
	9: 'Sleep'
};

/** The modes a thermostat endpoint offers, from its ControlSequenceOfOperation. */
export function systemModes(ep: Endpoint): number[] {
	if (is(ep, DEVICE_TYPE.roomAirConditioner)) return [1, 3, 4, 8, 7]; // room air conditioner
	const seq = ep.controlSequence ?? 4;
	const cool = [0, 1, 4, 5].includes(seq);
	const heat = [2, 3, 4, 5].includes(seq);
	return [...(cool && heat ? [1] : []), ...(cool ? [3] : []), ...(heat ? [4] : [])];
}

export const FAN_MODES = [
	{ value: '0', label: 'Off' },
	{ value: '1', label: 'Low' },
	{ value: '2', label: 'Medium' },
	{ value: '3', label: 'High' },
	{ value: '5', label: 'Auto' }
];
