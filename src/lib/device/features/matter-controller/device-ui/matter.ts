// Shared by the Matter panels (and other features' panels that show Matter devices).
import { live } from '../../web-ui/device-ui/live.svelte';

/** An endpoint as reported by `GET /api/matter/nodes`; on/off state and sensor values only once read or reported. */
export interface MatterEndpoint {
	id: number;
	deviceType: number;
	/** Users only: shown to them, but they may not control it. */
	readOnly?: boolean;
	on?: boolean;
	level?: number;
	ctMireds?: number;
	ctMinMireds?: number;
	ctMaxMireds?: number;
	/** In 0.01 °C. */
	temperature?: number;
	/** Relative humidity in 0.01 %. */
	humidity?: number;
	/** Seconds since the last temperature or humidity report. */
	measuredAge?: number;
	/** Buttons: FeatureMap of the Switch cluster, once reported. */
	switchFeatures?: number;
}

export interface MatterNode {
	id: number;
	name: string;
	vendor: string;
	product: string;
	network: string;
	/** Set by an admin, to group the dashboard by. */
	tags: string[];
	lastSeen: number | null;
	/** Only for battery-powered nodes, once they reported it (Power Source cluster). */
	battery?: {
		percent?: number;
		level?: 'ok' | 'warning' | 'critical';
		/** Seconds since the last report. */
		age: number;
	};
	/** Last read power draw (Electrical Power Measurement), once read. Often on its own endpoint. */
	power?: {
		mw: number;
		endpoint: number;
		/** Seconds since it was read. */
		age: number;
	};
	endpoints: MatterEndpoint[];
}

/** All panels share one poll loop of the node list. */
export const matterNodes = () =>
	live<{ nodes: MatterNode[]; capacity: number }>('/api/matter/nodes');

export const DEVICE_TYPES: Record<number, string> = {
	0x000a: 'Door Lock',
	0x000f: 'Generic Switch',
	0x0015: 'Contact Sensor',
	0x002b: 'Fan',
	0x002c: 'Air Quality Sensor',
	0x0041: 'Water Freeze Detector',
	0x0043: 'Water Leak Detector',
	0x0072: 'Room Air Conditioner',
	0x0076: 'Smoke/CO Alarm',
	0x0100: 'On/Off Light',
	0x0101: 'Dimmable Light',
	0x010c: 'Color Temperature Light',
	0x010d: 'Extended Color Light',
	0x010a: 'On/Off Plug-in Unit',
	0x010b: 'Dimmable Plug-in Unit',
	0x0103: 'On/Off Light Switch',
	0x0104: 'Dimmer Switch',
	0x0105: 'Color Dimmer Switch',
	0x0106: 'Light Sensor',
	0x0107: 'Occupancy Sensor',
	0x0202: 'Window Covering',
	0x0301: 'Thermostat',
	0x0302: 'Temperature Sensor',
	0x0305: 'Pressure Sensor',
	0x0307: 'Humidity Sensor'
};

/** Switchable endpoints: lights and plugs. */
export const SWITCHABLE_TYPES = [0x0100, 0x0101, 0x010c, 0x010d, 0x010a, 0x010b];
export const PLUG_TYPES = [0x010a, 0x010b];
export const DIMMABLE_TYPES = [0x0101, 0x010c, 0x010d, 0x010b];
export const COLOR_TEMPERATURE_TYPES = [0x010c, 0x010d];
/** Temperature and humidity sensors: the hub subscribes to their values. */
export const SENSOR_TYPES = [0x0302, 0x0307];
export const GENERIC_SWITCH = 0x000f;

export const nodeName = (n: MatterNode) =>
	n.name || [n.vendor, n.product].filter(Boolean).join(' ') || `Node ${n.id}`;

/** "Lamp" or, for nodes with several endpoints of the kind, "Remote – button 2". */
export function endpointName(node: MatterNode, ep: MatterEndpoint, kind = 'endpoint'): string {
	const same = node.endpoints.filter((e) => e.deviceType === ep.deviceType);
	return same.length > 1 ? `${nodeName(node)} – ${kind} ${same.indexOf(ep) + 1}` : nodeName(node);
}
