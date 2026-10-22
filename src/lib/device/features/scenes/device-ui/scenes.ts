// Scenes (espm_scenes.cpp): types and helpers shared by the panels and the dialog.
import type { MatterEndpoint } from '../../matter-controller/device-ui/matter';

/** A light a scene can switch (one endpoint of a node). */
export interface LightChoice {
	key: string;
	node: number;
	name: string;
	endpoint: MatterEndpoint;
}

export interface SceneLight {
	node: number;
	endpoint: number;
	on: boolean;
	/** 1–254, 0 = leave as is. */
	level: number;
	/** 0 = leave as is. */
	mireds: number;
}

export interface Scene {
	id: number;
	name: string;
	owner: string;
	/** Whom it's shared with: only for its owner and admins. */
	shared?: string[];
	lights: SceneLight[];
}

export interface ScenesResponse {
	max: number;
	maxLights: number;
	count: number;
	scenes: Scene[];
}

export const levelToPercent = (level: number) => Math.max(1, Math.round((level / 254) * 100));
export const percentToLevel = (p: number) =>
	Math.min(254, Math.max(1, Math.round((p / 100) * 254)));
/** Kelvin ↔ mireds, rounded to 50 K for display. */
export const miredsToKelvin = (m: number) => Math.round(1_000_000 / m / 50) * 50;
export const kelvinToMireds = (k: number) => Math.round(1_000_000 / k);

/** "3 lights · 2 on" */
export function summary(scene: Scene): string {
	const n = scene.lights.length;
	if (!n) return 'No lights';
	const on = scene.lights.filter((l) => l.on).length;
	const lights = `${n} light${n === 1 ? '' : 's'}`;
	return on === n ? `${lights} on` : on === 0 ? `${lights} off` : `${lights} · ${on} on`;
}
