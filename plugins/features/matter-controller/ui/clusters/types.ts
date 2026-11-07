import type { Endpoint } from '../matter';

/** What every cluster control gets. */
export interface ClusterProps {
	node: number;
	ep: Endpoint;
	disabled?: boolean;
	/** Sends an action, reports errors and refreshes the list afterwards. */
	run: (action: () => Promise<unknown>) => void;
}
