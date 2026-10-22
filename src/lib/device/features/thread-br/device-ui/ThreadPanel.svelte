<script lang="ts">
	import { live } from '../../web-ui/device-ui/live.svelte';
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import { Badge, DataList, Table } from '../../../device-ui/ui';

	/** `GET /api/thread` (espm_thread.cpp). */
	/** Only `radio` and `initialized` are set until the radio is `ready`. */
	interface ThreadInfo {
		radio: 'waiting' | 'starting' | 'ready';
		initialized: boolean;
		role: string;
		commissioned: boolean;
		networkName: string;
		channel: number;
		panId: string;
		extPanId: string;
		rloc16: string;
		extAddress: string;
		partitionId: number;
		leaderRouterId: number;
		omrPrefix?: string;
		neighbors: {
			extAddress: string;
			rloc16: string;
			child: boolean;
			ftd: boolean;
			rxOnWhenIdle: boolean;
			rssi: number;
			lqi: number;
			age: number;
		}[];
	}

	const thread = live<ThreadInfo>('/api/thread', 5000);
	const roleTone: Record<string, 'ok' | 'warn' | 'err'> = {
		leader: 'ok',
		router: 'ok',
		child: 'ok',
		detached: 'warn',
		disabled: 'err'
	};
</script>

<Panel title="Thread network">
	{#snippet badge()}
		{@const t = thread.data}
		{#if !t}
			<Badge>…</Badge>
		{:else if t.radio !== 'ready'}
			<Badge tone="err">{t.radio === 'waiting' ? 'no radio' : 'starting'}</Badge>
		{:else}
			<Badge tone={roleTone[t.role] ?? 'warn'}>
				{t.initialized ? t.role : 'radio not ready'}
			</Badge>
		{/if}
	{/snippet}

	{#if thread.data && thread.data.radio !== 'ready'}
		<p class={thread.data.radio === 'waiting' ? 'text-err' : 'text-muted'}>
			{#if thread.data.radio === 'waiting'}
				The Thread radio doesn’t answer – check its power, GND and the crossed TX/RX wires.
			{:else}
				The Thread radio answered, starting OpenThread…
			{/if}
		</p>
	{:else if thread.data}
		{@const t = thread.data}
		<DataList>
			{#if t.commissioned}
				<dt>Network</dt>
				<dd>{t.networkName}</dd>
				<dt>Channel</dt>
				<dd>{t.channel}</dd>
				<dt>PAN ID</dt>
				<dd>{t.panId}</dd>
				<dt>Ext. PAN ID</dt>
				<dd class="font-mono text-xs">{t.extPanId}</dd>
				<dt>RLOC16</dt>
				<dd>{t.rloc16}</dd>
				<dt>OMR prefix</dt>
				<dd>
					{#if t.omrPrefix}<span class="font-mono text-xs">{t.omrPrefix}</span>{:else}<span
							class="text-muted">–</span
						>{/if}
				</dd>
				<dt>Partition</dt>
				<dd>{t.partitionId}</dd>
			{:else}
				<dt>Status</dt>
				<dd class="text-warn">No Thread network configured</dd>
			{/if}
		</DataList>

		<h3 class="mt-4 mb-1.5 text-sm">Neighbors</h3>
		<Table>
			<thead>
				<tr>
					<th>Ext. address</th><th>RLOC16</th><th>Type</th><th>RSSI</th><th>LQI</th><th
						>Last heard</th
					>
				</tr>
			</thead>
			<tbody>
				{#each t.neighbors as n (n.extAddress)}
					<tr>
						<td class="font-mono text-xs">{n.extAddress}</td>
						<td class="font-mono text-xs">{n.rloc16}</td>
						<td>{n.child ? (n.rxOnWhenIdle ? 'Child' : 'Sleepy child') : 'Router'}</td>
						<td>{n.rssi} dBm</td>
						<td>{n.lqi}</td>
						<td>{n.age} s</td>
					</tr>
				{:else}
					<tr><td colspan="6" class="text-muted">No neighbors yet</td></tr>
				{/each}
			</tbody>
		</Table>
	{:else if thread.error}
		<p class="text-err">{thread.error}</p>
	{:else}
		<p class="text-muted">Loading…</p>
	{/if}
</Panel>
