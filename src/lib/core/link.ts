/**
 * How a firmware talks to the app: where updates come from, how the app reaches it and – on a
 * hub – whether other devices go through it. Core, not a plugin: only what is chosen is compiled in.
 */
import type { DeviceKind } from '#sdk';
import type { Resolved } from './engine';

/** The app reaches the device through a tunnel the device opens, through its hub, or not at all. */
export type AccessVia = 'tunnel' | 'hub' | 'off';

export interface AppLink {
	access: AccessVia;
	/** Hub: other devices reach the app through it, and the app them. */
	relay: boolean;
}

export interface LinkOptions {
	access: AccessVia[];
	relay: boolean;
}

/**
 * A hub talks to the app itself; a device gets its updates from its hub. Wi-Fi devices choose how
 * the app reaches them, Thread devices always go through a hub.
 */
export function linkOptions(kind: DeviceKind, uplink: boolean): LinkOptions {
	if (kind === 'hub') return { access: ['tunnel', 'off'], relay: true };
	if (uplink) return { access: ['tunnel', 'hub'], relay: false };
	return { access: ['hub'], relay: false };
}

export const defaultLink = (kind: DeviceKind): AppLink => ({
	access: 'tunnel',
	relay: kind === 'hub'
});

/** Stored choices, safe on untrusted input (kept when they don't fit the transport, see `appLink`). */
export function normalizeLink(raw: unknown, kind: DeviceKind): AppLink {
	const l = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppLink>;
	const d = defaultLink(kind);
	return {
		access: l.access === 'tunnel' || l.access === 'hub' || l.access === 'off' ? l.access : d.access,
		relay: kind === 'hub' && (l.relay === undefined ? d.relay : !!l.relay)
	};
}

export interface EffectiveLink extends AppLink {
	options: LinkOptions;
	/** Talks to the app itself: needs an app URL. */
	direct: boolean;
	/** A device the app reaches (and that reports) through its hub's relay. */
	viaHub: boolean;
}

/** The link a firmware really has: a choice its transport doesn't allow falls back to the first. */
export function appLink(r: Resolved): EffectiveLink {
	const kind = r.config.kind;
	const options = linkOptions(kind, r.has('uplink'));
	const want = r.config.link;
	const access = options.access.includes(want.access) ? want.access : options.access[0];
	const relay = options.relay && want.relay;
	return {
		access,
		relay,
		options,
		direct: kind === 'hub' || access === 'tunnel',
		viaHub: kind !== 'hub' && access === 'hub'
	};
}

export const ACCESS_LABEL: Record<AccessVia, string> = {
	tunnel: 'Own tunnel',
	hub: 'Through the hub',
	off: 'Off'
};
