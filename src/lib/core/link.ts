/**
 * How a firmware talks to the app: where updates come from, how the app reaches it and – on a
 * hub – whether other devices go through it. Core, not a plugin: only what is chosen is compiled in.
 */
import type { DeviceKind } from '#sdk';
import type { Resolved } from './engine';

/** Updates (and status reports): pulled from the app itself, or through the hub. */
export type UpdatesVia = 'app' | 'hub';
/** The app reaches the device through a tunnel the device opens, through its hub, or not at all. */
export type AccessVia = 'tunnel' | 'hub' | 'off';

export interface AppLink {
	updates: UpdatesVia;
	access: AccessVia;
	/** Hub: other devices reach the app through it, and the app them. */
	relay: boolean;
}

export interface LinkOptions {
	updates: UpdatesVia[];
	access: AccessVia[];
	relay: boolean;
}

/** A hub talks to the app itself, Wi-Fi devices choose, Thread devices always go through a hub. */
export function linkOptions(kind: DeviceKind, uplink: boolean): LinkOptions {
	if (kind === 'hub') return { updates: ['app'], access: ['tunnel', 'off'], relay: true };
	if (uplink) return { updates: ['app', 'hub'], access: ['tunnel', 'hub'], relay: false };
	return { updates: ['hub'], access: ['hub'], relay: false };
}

export const defaultLink = (kind: DeviceKind): AppLink => ({
	updates: 'app',
	access: 'tunnel',
	relay: kind === 'hub'
});

/** Stored choices, safe on untrusted input (kept when they don't fit the transport, see `appLink`). */
export function normalizeLink(raw: unknown, kind: DeviceKind): AppLink {
	const l = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppLink>;
	const d = defaultLink(kind);
	return {
		updates: l.updates === 'hub' || l.updates === 'app' ? l.updates : d.updates,
		access: l.access === 'tunnel' || l.access === 'hub' || l.access === 'off' ? l.access : d.access,
		relay: kind === 'hub' && (l.relay === undefined ? d.relay : !!l.relay)
	};
}

export interface EffectiveLink extends AppLink {
	options: LinkOptions;
	/** Talks to the app itself: needs an app URL. */
	direct: boolean;
	/** A device that uses a hub for updates or access. */
	viaHub: boolean;
}

/** The link a firmware really has: a choice its transport doesn't allow falls back to the first. */
export function appLink(r: Resolved): EffectiveLink {
	const kind = r.config.kind;
	const options = linkOptions(kind, r.has('uplink'));
	const want = r.config.link;
	const updates = options.updates.includes(want.updates) ? want.updates : options.updates[0];
	const access = options.access.includes(want.access) ? want.access : options.access[0];
	const relay = options.relay && want.relay;
	return {
		updates,
		access,
		relay,
		options,
		direct: kind === 'hub' || updates === 'app' || access === 'tunnel',
		viaHub: kind !== 'hub' && (updates === 'hub' || access === 'hub')
	};
}

export const UPDATES_LABEL: Record<UpdatesVia, string> = {
	app: 'From the app',
	hub: 'Through the hub'
};
export const ACCESS_LABEL: Record<AccessVia, string> = {
	tunnel: 'Own tunnel',
	hub: 'Through the hub',
	off: 'Off'
};
