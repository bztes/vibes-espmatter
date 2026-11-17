/** Links between devices (`/api/v1/controller/links`): Bindings the hub sets up. */
import { api } from '#sdk/device-ui';
import { clusterName } from '#sdk/matter';
import { CLUSTER, hasCluster, type Endpoint, type Node } from './matter';

export interface Link {
	cluster: number;
	node: number;
	endpoint: number;
}

export interface LinkState {
	state: 'idle' | 'busy';
	error?: string;
	/** Missing: not read yet. */
	links?: Link[];
}

/** `read`: read them from the device again, not what the hub remembers. */
export const getLinks = (node: number, endpoint: number, read = false) =>
	api<LinkState>(
		`/api/v1/controller/links?node=${node}&endpoint=${endpoint}${read ? '&read=1' : ''}`
	);

export const setLinks = (node: number, endpoint: number, cluster: number, targets: Target[]) =>
	api<LinkState>('/api/v1/controller/links', {
		method: 'PUT',
		body: {
			node,
			endpoint,
			cluster,
			targets: targets.map((t) => ({ node: t.node, endpoint: t.endpoint }))
		}
	});

/** Links a device follows one of: a sensor is read, not combined. */
const SINGLE: number[] = [
	CLUSTER.temperatureMeasurement,
	CLUSTER.relativeHumidityMeasurement,
	CLUSTER.pressureMeasurement,
	CLUSTER.illuminanceMeasurement,
	CLUSTER.occupancySensing,
	CLUSTER.booleanState
];

/** What a link of the cluster does, from the linked device's view. */
const VERBS: Partial<Record<number, string>> = {
	[CLUSTER.onOff]: 'Switches',
	[CLUSTER.levelControl]: 'Dims',
	[CLUSTER.colorControl]: 'Sets the color of',
	[CLUSTER.windowCovering]: 'Moves',
	[CLUSTER.thermostat]: 'Controls',
	[CLUSTER.temperatureMeasurement]: 'Room temperature from',
	[CLUSTER.relativeHumidityMeasurement]: 'Humidity from',
	[CLUSTER.occupancySensing]: 'Occupancy from'
};

export interface Target {
	key: string;
	node: number;
	endpoint: number;
	label: string;
}

export interface LinkGroup {
	key: string;
	endpoint: number;
	cluster: number;
	label: string;
	single: boolean;
	/** Endpoints of other devices serving the cluster. */
	targets: Target[];
}

export const targetKey = (node: number, endpoint: number) => `${node}:${endpoint}`;

/** The clusters an endpoint can be linked for, with what it can be linked to. */
export function linkGroups(node: Node, ep: Endpoint, nodes: Node[], several: boolean): LinkGroup[] {
	return (ep.clientClusters ?? []).flatMap((cluster) => {
		if (!(cluster in VERBS) && !SINGLE.includes(cluster)) return [];
		const targets = nodes
			.filter((n) => n.id !== node.id)
			.flatMap((n) => {
				const eps = n.endpoints.filter((e) => hasCluster(e, cluster));
				return eps.map((e) => ({
					key: targetKey(n.id, e.id),
					node: n.id,
					endpoint: e.id,
					label: eps.length > 1 ? `${n.name} · endpoint ${e.id}` : n.name
				}));
			});
		if (!targets.length) return [];
		const verb = VERBS[cluster] ?? clusterName(cluster);
		return [
			{
				key: `${ep.id}:${cluster}`,
				endpoint: ep.id,
				cluster,
				label: several ? `Endpoint ${ep.id} · ${verb}` : verb,
				single: SINGLE.includes(cluster),
				targets
			}
		];
	});
}
