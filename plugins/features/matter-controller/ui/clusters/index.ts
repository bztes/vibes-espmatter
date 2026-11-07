/**
 * Cluster → UI. An endpoint's card shows, in this order, the control of every cluster it serves,
 * then one reading per measurement cluster. The device type only names the card; a Dimmable Light
 * and a Dimmable Plug-in Unit look the same because both serve On/Off and Level Control.
 *
 * Support for another cluster: add a component (or a reading) here, and its attributes to
 * `ATTRS` in the hub firmware so the hub reports them.
 */
import type { Component } from 'svelte';
import { DEVICE_TYPE, isUtility } from '#sdk/matter';
import { CLUSTER, clustersOf, is, type Endpoint, type Node } from '../matter';
import ColorControl from './ColorControl.svelte';
import DoorLock from './DoorLock.svelte';
import FanControl from './FanControl.svelte';
import LevelControl from './LevelControl.svelte';
import OnOff from './OnOff.svelte';
import Thermostat from './Thermostat.svelte';
import WindowCovering from './WindowCovering.svelte';
import type { ClusterProps } from './types';

export type { ClusterProps };

export const CONTROLS: { cluster: number; component: Component<ClusterProps> }[] = [
	{ cluster: CLUSTER.onOff, component: OnOff },
	{ cluster: CLUSTER.levelControl, component: LevelControl },
	{ cluster: CLUSTER.colorControl, component: ColorControl },
	{ cluster: CLUSTER.windowCovering, component: WindowCovering },
	{ cluster: CLUSTER.doorLock, component: DoorLock },
	{ cluster: CLUSTER.thermostat, component: Thermostat },
	{ cluster: CLUSTER.fanControl, component: FanControl }
];

export interface Reading {
	cluster: number;
	label: (ep: Endpoint) => string;
	value: (ep: Endpoint) => string | undefined;
	unit?: string;
	tone?: (ep: Endpoint) => 'default' | 'warn' | 'accent';
}

const fixed = (v: number | null | undefined, digits: number) =>
	v == null ? undefined : v.toFixed(digits);

/** Boolean State: what `true` means depends on the device type. */
const booleanState = (ep: Endpoint) => {
	if (ep.stateValue == null) return undefined;
	if (is(ep, DEVICE_TYPE.contactSensor)) return ep.stateValue ? 'Closed' : 'Open';
	if (is(ep, DEVICE_TYPE.waterLeakDetector)) return ep.stateValue ? 'Leak' : 'Dry';
	return ep.stateValue ? 'On' : 'Off';
};

export const READINGS: Reading[] = [
	{
		cluster: CLUSTER.temperatureMeasurement,
		label: () => 'Temperature',
		value: (ep) => fixed(ep.temperature, 1),
		unit: '°C'
	},
	{
		cluster: CLUSTER.relativeHumidityMeasurement,
		label: () => 'Humidity',
		value: (ep) => fixed(ep.humidity, 0),
		unit: '%'
	},
	{
		cluster: CLUSTER.illuminanceMeasurement,
		label: () => 'Light',
		value: (ep) => fixed(ep.illuminance, 0),
		unit: 'lx'
	},
	{
		cluster: CLUSTER.pressureMeasurement,
		label: () => 'Pressure',
		value: (ep) => fixed(ep.pressure, 0),
		unit: 'hPa'
	},
	{
		cluster: CLUSTER.electricalPowerMeasurement,
		label: () => 'Power',
		value: (ep) =>
			ep.power == null ? undefined : fixed(ep.power, Math.abs(ep.power) < 10 ? 1 : 0),
		unit: 'W'
	},
	{
		cluster: CLUSTER.electricalEnergyMeasurement,
		label: () => 'Energy',
		value: (ep) => (ep.energy == null ? undefined : fixed(ep.energy, ep.energy < 100 ? 2 : 1)),
		unit: 'kWh'
	},
	{
		cluster: CLUSTER.booleanState,
		label: (ep) =>
			is(ep, DEVICE_TYPE.contactSensor)
				? 'Contact'
				: is(ep, DEVICE_TYPE.waterLeakDetector)
					? 'Water'
					: 'State',
		value: booleanState,
		tone: (ep) => (['Leak', 'Open'].includes(booleanState(ep) ?? '') ? 'warn' : 'default')
	},
	{
		cluster: CLUSTER.occupancySensing,
		label: () => 'Occupancy',
		value: (ep) => (ep.occupied == null ? undefined : ep.occupied ? 'Occupied' : 'Clear'),
		tone: (ep) => (ep.occupied ? 'accent' : 'default')
	}
];

const SUPPORTED = new Set([...CONTROLS, ...READINGS].map((c) => c.cluster));

export const controlsOf = (ep: Endpoint) => {
	const clusters = clustersOf(ep);
	return CONTROLS.filter((c) => clusters.includes(c.cluster));
};

export const readingsOf = (ep: Endpoint) => {
	const clusters = clustersOf(ep);
	return READINGS.filter((r) => clusters.includes(r.cluster));
};

/** Whether the dashboard has a control or a reading for the endpoint. */
export const hasControls = (ep: Endpoint) => clustersOf(ep).some((c) => SUPPORTED.has(c));

/** Endpoints worth a section: something to show, or a real device type we can't control. */
export const visibleEndpoints = (node: Node) =>
	node.endpoints.filter((ep) => hasControls(ep) || ep.deviceTypes.some((t) => !isUtility(t)));

/** Endpoints the dashboard has a control or a reading for; the rest stays off the dashboard. */
export const controllableEndpoints = (node: Node) => node.endpoints.filter(hasControls);

/** What a lamp, plug, blind … looks like on its card. */
export type DeviceKind =
	| 'light'
	| 'plug'
	| 'thermostat'
	| 'fan'
	| 'blinds'
	| 'lock'
	| 'contact'
	| 'leak'
	| 'motion'
	| 'climate'
	| 'sensor'
	| 'device';

export function deviceKind(ep: Endpoint): DeviceKind {
	const D = DEVICE_TYPE;
	const any = (...types: number[]) => types.some((t) => is(ep, t));
	const clusters = clustersOf(ep);
	if (any(D.onOffLight, D.dimmableLight, D.colorTemperatureLight, D.extendedColorLight))
		return 'light';
	if (any(D.thermostat, D.roomAirConditioner) || clusters.includes(CLUSTER.thermostat))
		return 'thermostat';
	if (any(D.fan, D.airPurifier) || clusters.includes(CLUSTER.fanControl)) return 'fan';
	if (any(D.windowCovering) || clusters.includes(CLUSTER.windowCovering)) return 'blinds';
	if (any(D.doorLock) || clusters.includes(CLUSTER.doorLock)) return 'lock';
	if (any(D.contactSensor)) return 'contact';
	if (any(D.waterLeakDetector)) return 'leak';
	if (any(D.occupancySensor) || clusters.includes(CLUSTER.occupancySensing)) return 'motion';
	if (
		any(D.temperatureSensor, D.humiditySensor) ||
		clusters.includes(CLUSTER.temperatureMeasurement) ||
		clusters.includes(CLUSTER.relativeHumidityMeasurement)
	)
		return 'climate';
	if (clusters.includes(CLUSTER.onOff)) return 'plug';
	if (readingsOf(ep).length) return 'sensor';
	return 'device';
}

/** Whether the endpoint is "on" – its card is tinted then. */
export const isActive = (ep: Endpoint) =>
	ep.on === true ||
	(ep.systemMode != null && ep.systemMode !== 0 && ep.on !== false) ||
	(ep.fanMode != null && ep.fanMode !== 0) ||
	ep.lockState === 2 ||
	ep.lockState === 3;

/** Something needs attention: a leak, an open contact. */
export const isAlert = (ep: Endpoint) => readingsOf(ep).some((r) => r.tone?.(ep) === 'warn');

const LOCK_STATES = ['Not fully locked', 'Locked', 'Unlocked', 'Unlatched'];
const FAN = ['Off', 'Low', 'Medium', 'High', 'On', 'Auto', 'Smart'];

/** One short line about the endpoint's state, e.g. "On · 70 %", "21.5 °C · heating to 22". */
export function summary(ep: Endpoint): string | undefined {
	const clusters = clustersOf(ep);
	const has = (c: number) => clusters.includes(c);
	if (has(CLUSTER.thermostat)) {
		const parts: string[] = [];
		if (ep.localTemperature != null) parts.push(`${ep.localTemperature.toFixed(1)} °C`);
		if (ep.systemMode === 0 || ep.on === false) parts.push('Off');
		else if (ep.systemMode === 3 && ep.coolingSetpoint != null)
			parts.push(`cooling to ${ep.coolingSetpoint}°`);
		else if (ep.heatingSetpoint != null) parts.push(`heating to ${ep.heatingSetpoint}°`);
		return parts.join(' · ') || undefined;
	}
	if (has(CLUSTER.doorLock) && ep.lockState != null) return LOCK_STATES[ep.lockState];
	if (has(CLUSTER.windowCovering) && ep.closedPercent != null) {
		const p = Math.round(ep.closedPercent);
		return p <= 0 ? 'Open' : p >= 100 ? 'Closed' : `${100 - p} % open`;
	}
	if (has(CLUSTER.fanControl) && ep.fanMode != null) return FAN[ep.fanMode] ?? undefined;
	if (has(CLUSTER.onOff) && ep.on != null) {
		if (!ep.on) return 'Off';
		if (has(CLUSTER.levelControl) && ep.level != null)
			return `On · ${Math.round((ep.level / 254) * 100)} %`;
		if (ep.power != null) return `On · ${Math.round(ep.power)} W`;
		return 'On';
	}
	return undefined;
}
