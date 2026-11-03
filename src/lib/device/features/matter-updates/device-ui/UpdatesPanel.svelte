<script lang="ts">
	import { fmtAgo } from '../../web-ui/device-ui/api';
	import { live } from '../../web-ui/device-ui/live.svelte';
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import { Badge, Table } from '../../../device-ui/ui';
	import { matterNodes, nodeName } from '../../matter-controller/device-ui/matter';

	type State = 'requested' | 'downloading' | 'installing' | 'done' | 'failed';

	interface DeviceUpdate {
		id: number;
		state: State;
		version?: string;
		error?: string;
		age: number;
	}

	const nodes = matterNodes();
	const updates = live<{ server: string; devices: DeviceUpdate[] }>('/api/matter/updates', 5000);
	const name = (id: number) => {
		const node = nodes.data?.nodes.find((n) => n.id === id);
		return node ? nodeName(node) : `Node ${id}`;
	};

	const LABEL: Record<State, string> = {
		requested: 'Starting…',
		downloading: 'Downloading…',
		installing: 'Restarting…',
		done: 'Updated',
		failed: 'Failed'
	};
</script>

<Panel title="Device updates">
	<p class="text-muted mb-3 text-sm">
		Start updates of your devices in the vibes-espmatter app (“Over Matter” on the build page). The
		hub checks {updates.data?.server || 'the app'} every 5 minutes and passes them on – over Thread that
		takes several minutes.
	</p>
	{#if updates.data?.devices.length}
		<Table>
			<thead><tr><th>Device</th><th>Update</th><th>State</th></tr></thead>
			<tbody>
				{#each updates.data.devices as u (u.id)}
					<tr>
						<td><strong>{name(u.id)}</strong></td>
						<td>{u.version ?? '–'}</td>
						<td>
							<Badge>{LABEL[u.state]}</Badge>
							<span class="text-muted text-sm">{fmtAgo(u.age)} ago</span>
							{#if u.error}<div class="text-err text-sm">{u.error}</div>{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</Table>
	{:else}
		<p class="text-muted text-sm">{updates.error ?? 'No updates yet.'}</p>
	{/if}
</Panel>
