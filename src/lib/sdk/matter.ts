/**
 * `#sdk/matter` – Matter clusters and device types, shared by peripherals (what they implement) and the
 * controller UI (what it shows).
 *
 * A cluster is one capability (On/Off, Level Control …). A device type says what a thing *is*
 * (light, plug …) and which clusters it must have. Clusters don't determine the device type:
 * On/Off + Level Control is a Dimmable Light, a Dimmable Plug-in Unit or a Mounted Dimmable Load
 * Control.
 */

import * as M from './matter-model';

export * from './matter-model';

/** Application cluster IDs. Identify, Groups, Scenes and Descriptor are left out: every endpoint has them. */
export const CLUSTER = {
	onOff: M.OnOff.id,
	levelControl: M.LevelControl.id,
	switch: M.Switch.id,
	booleanState: M.BooleanState.id,
	smokeCoAlarm: M.SmokeCoAlarm.id,
	doorLock: M.DoorLock.id,
	windowCovering: M.WindowCovering.id,
	thermostat: M.Thermostat.id,
	fanControl: M.FanControl.id,
	colorControl: M.ColorControl.id,
	illuminanceMeasurement: M.IlluminanceMeasurement.id,
	temperatureMeasurement: M.TemperatureMeasurement.id,
	pressureMeasurement: M.PressureMeasurement.id,
	flowMeasurement: M.FlowMeasurement.id,
	relativeHumidityMeasurement: M.RelativeHumidityMeasurement.id,
	occupancySensing: M.OccupancySensing.id,
	electricalPowerMeasurement: M.ElectricalPowerMeasurement.id,
	electricalEnergyMeasurement: M.ElectricalEnergyMeasurement.id
} as const;

export type ClusterId = (typeof CLUSTER)[keyof typeof CLUSTER];

export const CLUSTER_NAMES: Record<ClusterId, string> = {
	[CLUSTER.onOff]: 'On/Off',
	[CLUSTER.levelControl]: 'Level Control',
	[CLUSTER.switch]: 'Switch',
	[CLUSTER.booleanState]: 'Boolean State',
	[CLUSTER.smokeCoAlarm]: 'Smoke CO Alarm',
	[CLUSTER.doorLock]: 'Door Lock',
	[CLUSTER.windowCovering]: 'Window Covering',
	[CLUSTER.thermostat]: 'Thermostat',
	[CLUSTER.fanControl]: 'Fan Control',
	[CLUSTER.colorControl]: 'Color Control',
	[CLUSTER.illuminanceMeasurement]: 'Illuminance Measurement',
	[CLUSTER.temperatureMeasurement]: 'Temperature Measurement',
	[CLUSTER.pressureMeasurement]: 'Pressure Measurement',
	[CLUSTER.flowMeasurement]: 'Flow Measurement',
	[CLUSTER.relativeHumidityMeasurement]: 'Relative Humidity Measurement',
	[CLUSTER.occupancySensing]: 'Occupancy Sensing',
	[CLUSTER.electricalPowerMeasurement]: 'Electrical Power Measurement',
	[CLUSTER.electricalEnergyMeasurement]: 'Electrical Energy Measurement'
};

export const DEVICE_TYPE = {
	// Infrastructure – no device of their own
	rootNode: 0x0016,
	powerSource: 0x0011,
	otaRequestor: 0x0012,
	otaProvider: 0x0014,
	aggregator: 0x000e,
	bridgedNode: 0x0013,
	// Measures power next to what it measures (e.g. a plug's endpoint)
	electricalSensor: 0x0510,
	// Lighting
	onOffLight: 0x0100,
	dimmableLight: 0x0101,
	colorTemperatureLight: 0x010c,
	extendedColorLight: 0x010d,
	// Plugs and actuators
	onOffPlugInUnit: 0x010a,
	dimmablePlugInUnit: 0x010b,
	mountedOnOffControl: 0x010f,
	mountedDimmableLoadControl: 0x0110,
	// Switches – they send commands to bound devices, nothing to control on them
	onOffLightSwitch: 0x0103,
	dimmerSwitch: 0x0104,
	colorDimmerSwitch: 0x0105,
	genericSwitch: 0x000f,
	// Sensors
	contactSensor: 0x0015,
	waterLeakDetector: 0x0043,
	smokeCoAlarm: 0x0076,
	lightSensor: 0x0106,
	occupancySensor: 0x0107,
	temperatureSensor: 0x0302,
	pressureSensor: 0x0305,
	flowSensor: 0x0306,
	humiditySensor: 0x0307,
	// Closures
	doorLock: 0x000a,
	windowCovering: 0x0202,
	// HVAC
	fan: 0x002b,
	airPurifier: 0x002d,
	roomAirConditioner: 0x0072,
	thermostat: 0x0301
} as const;

export type DeviceTypeId = (typeof DEVICE_TYPE)[keyof typeof DEVICE_TYPE];

export interface DeviceTypeInfo {
	name: string;
	/** Application clusters the device type requires (server side). */
	clusters: ClusterId[];
	/** Describes the node or its plumbing, not something to control. */
	utility?: boolean;
}

const C = CLUSTER;
const D = DEVICE_TYPE;

export const DEVICE_TYPES: Record<DeviceTypeId, DeviceTypeInfo> = {
	[D.rootNode]: { name: 'Root node', clusters: [], utility: true },
	[D.powerSource]: { name: 'Power source', clusters: [], utility: true },
	[D.electricalSensor]: {
		name: 'Electrical Sensor',
		clusters: [C.electricalPowerMeasurement, C.electricalEnergyMeasurement],
		utility: true
	},
	[D.otaRequestor]: { name: 'OTA requestor', clusters: [], utility: true },
	[D.otaProvider]: { name: 'OTA provider', clusters: [], utility: true },
	[D.aggregator]: { name: 'Aggregator', clusters: [], utility: true },
	[D.bridgedNode]: { name: 'Bridged device', clusters: [], utility: true },

	[D.onOffLight]: { name: 'On/Off Light', clusters: [C.onOff] },
	[D.dimmableLight]: { name: 'Dimmable Light', clusters: [C.onOff, C.levelControl] },
	[D.colorTemperatureLight]: {
		name: 'Color Temperature Light',
		clusters: [C.onOff, C.levelControl, C.colorControl]
	},
	[D.extendedColorLight]: {
		name: 'Extended Color Light',
		clusters: [C.onOff, C.levelControl, C.colorControl]
	},

	[D.onOffPlugInUnit]: { name: 'On/Off Plug-in Unit', clusters: [C.onOff] },
	[D.dimmablePlugInUnit]: { name: 'Dimmable Plug-in Unit', clusters: [C.onOff, C.levelControl] },
	[D.mountedOnOffControl]: { name: 'Mounted On/Off Control', clusters: [C.onOff] },
	[D.mountedDimmableLoadControl]: {
		name: 'Mounted Dimmable Load Control',
		clusters: [C.onOff, C.levelControl]
	},

	[D.onOffLightSwitch]: { name: 'On/Off Light Switch', clusters: [] },
	[D.dimmerSwitch]: { name: 'Dimmer Switch', clusters: [] },
	[D.colorDimmerSwitch]: { name: 'Color Dimmer Switch', clusters: [] },
	[D.genericSwitch]: { name: 'Generic Switch', clusters: [] },

	[D.contactSensor]: { name: 'Contact Sensor', clusters: [C.booleanState] },
	[D.waterLeakDetector]: { name: 'Water Leak Detector', clusters: [C.booleanState] },
	[D.smokeCoAlarm]: { name: 'Smoke CO Alarm', clusters: [C.smokeCoAlarm] },
	[D.lightSensor]: { name: 'Light Sensor', clusters: [C.illuminanceMeasurement] },
	[D.occupancySensor]: { name: 'Occupancy Sensor', clusters: [C.occupancySensing] },
	[D.temperatureSensor]: { name: 'Temperature Sensor', clusters: [C.temperatureMeasurement] },
	[D.pressureSensor]: { name: 'Pressure Sensor', clusters: [C.pressureMeasurement] },
	[D.flowSensor]: { name: 'Flow Sensor', clusters: [C.flowMeasurement] },
	[D.humiditySensor]: { name: 'Humidity Sensor', clusters: [C.relativeHumidityMeasurement] },

	[D.doorLock]: { name: 'Door Lock', clusters: [C.doorLock] },
	[D.windowCovering]: { name: 'Window Covering', clusters: [C.windowCovering] },

	[D.fan]: { name: 'Fan', clusters: [C.fanControl] },
	[D.airPurifier]: { name: 'Air Purifier', clusters: [C.fanControl] },
	[D.roomAirConditioner]: { name: 'Room Air Conditioner', clusters: [C.onOff, C.thermostat] },
	[D.thermostat]: { name: 'Thermostat', clusters: [C.thermostat] }
};

const hex = (id: number) => `0x${id.toString(16).toUpperCase().padStart(4, '0')}`;

export const deviceTypeName = (id: number) =>
	DEVICE_TYPES[id as DeviceTypeId]?.name ?? `Device type ${hex(id)}`;

export const clusterName = (id: number) =>
	CLUSTER_NAMES[id as ClusterId] ?? M.IDL_NAMES[id] ?? `Cluster ${hex(id)}`;

export const isUtility = (id: number) => !!DEVICE_TYPES[id as DeviceTypeId]?.utility;

/** One Matter endpoint a peripheral creates. */
export interface MatterEndpoint {
	deviceType: DeviceTypeId;
	/** All application clusters the endpoint serves – the device type's required ones plus optional ones. */
	clusters: ClusterId[];
}

/** The device types of some endpoints, for display, e.g. `Temperature Sensor · Humidity Sensor`. */
export const deviceTypeNames = (endpoints: MatterEndpoint[], separator = ' · ') =>
	[...new Set(endpoints.map((e) => deviceTypeName(e.deviceType)))].join(separator);

/** Problems of an endpoint declaration: unknown device type, required clusters missing. */
export function checkEndpoint(ep: MatterEndpoint): string[] {
	const info = DEVICE_TYPES[ep.deviceType];
	if (!info) return [`unknown device type ${hex(ep.deviceType)}`];
	if (info.utility) return [`${info.name} is no device of its own`];
	return info.clusters
		.filter((c) => !ep.clusters.includes(c))
		.map((c) => `${info.name} requires the ${clusterName(c)} cluster`);
}
