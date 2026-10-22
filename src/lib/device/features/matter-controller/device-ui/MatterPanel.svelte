<script lang="ts">
	import BatteryFull from '@lucide/svelte/icons/battery-full';
	import BatteryLow from '@lucide/svelte/icons/battery-low';
	import BatteryMedium from '@lucide/svelte/icons/battery-medium';
	import BatteryWarning from '@lucide/svelte/icons/battery-warning';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import Pencil from '@lucide/svelte/icons/pencil';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Siren from '@lucide/svelte/icons/siren';
	import Tag from '@lucide/svelte/icons/tag';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Menu from '../../../device-ui/Menu.svelte';
	import QrScanButton from './QrScanButton.svelte';
	import { api, errorMessage, fmtAgo, hexId, type Body } from '../../web-ui/device-ui/api';
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import {
		Badge,
		Button,
		Input,
		Select,
		showAlert,
		showConfirm,
		showPrompt,
		Table
	} from '../../../device-ui/ui';
	import { DEVICE_TYPES, matterNodes, type MatterNode } from './matter';

	interface PairStatus {
		state: 'idle' | 'running' | 'success' | 'failed';
		nodeId?: number;
		error?: string;
		elapsed?: number;
	}

	const CLUSTER_IDENTIFY = 3;

	/** Icon and color of a battery: the device's own charge level wins over the percentage. */
	function batteryLook({ percent, level }: NonNullable<MatterNode['battery']>) {
		if (level === 'critical' || (percent ?? 100) < 10)
			return { icon: BatteryWarning, cls: 'text-err' };
		if (level === 'warning' || (percent ?? 100) < 25) return { icon: BatteryLow, cls: 'text-warn' };
		if ((percent ?? 100) < 60) return { icon: BatteryMedium, cls: '' };
		return { icon: BatteryFull, cls: 'text-ok' };
	}

	const nodes = matterNodes();
	let pair = $state<PairStatus>({ state: 'idle' });
	let pairError = $state('');
	let code = $state('');

	async function nodeAction(node: MatterNode, action: string, extra: Body = {}) {
		try {
			await api('/api/matter/node', { body: { id: hexId(node.id), action, ...extra } });
			await nodes.refresh();
		} catch (e) {
			showAlert('Device action failed', errorMessage(e));
		}
	}

	async function rename(node: MatterNode) {
		const name = await showPrompt('Rename device', 'Name', node.name);
		if (name !== null) nodeAction(node, 'rename', { name });
	}

	async function editTags(node: MatterNode) {
		const tags = await showPrompt(
			'Edit tags',
			'Tags (comma-separated, e.g. Living room, Kitchen)',
			node.tags.join(', ')
		);
		if (tags !== null) nodeAction(node, 'tag', { tags });
	}

	const actions = (n: MatterNode) => [
		{
			label: 'Identify (blink)',
			icon: Siren,
			onclick: () =>
				nodeAction(n, 'invoke', {
					endpoint: n.endpoints[0]?.id ?? 1,
					cluster: CLUSTER_IDENTIFY,
					command: 0,
					data: JSON.stringify({ '0:U16': 5 })
				})
		},
		{ label: 'Refresh', icon: RefreshCw, onclick: () => nodeAction(n, 'refresh') },
		{ label: 'Rename', icon: Pencil, onclick: () => rename(n) },
		{ label: 'Tags', icon: Tag, onclick: () => editTags(n) },
		{
			label: 'Remove',
			icon: Trash2,
			danger: true,
			onclick: async () => {
				const ok = await showConfirm('Remove device', 'Remove this device from the hub fabric?', {
					action: 'Remove',
					danger: true
				});
				if (ok) nodeAction(n, 'remove');
			}
		}
	];

	async function watchPairing() {
		try {
			pair = await api<PairStatus>('/api/matter/pair');
		} catch (e) {
			pairError = errorMessage(e);
			return;
		}
		if (pair.state === 'running') setTimeout(watchPairing, 1500);
		else if (pair.state === 'success') setTimeout(() => nodes.refresh(), 2000);
	}
	watchPairing();

	async function startPairing(ev: SubmitEvent) {
		ev.preventDefault();
		const f = new FormData(ev.currentTarget as HTMLFormElement);
		const setup = code.trim();
		pairError = '';
		try {
			await api('/api/matter/pair', {
				body: {
					code: setup.toUpperCase().startsWith('MT:') ? setup : setup.replace(/[^0-9]/g, ''),
					name: String(f.get('name')),
					network: String(f.get('network'))
				}
			});
			watchPairing();
		} catch (e) {
			pairError = errorMessage(e);
		}
	}
</script>

<Panel title="Matter devices">
	{#snippet badge()}
		<Badge>{nodes.data ? `${nodes.data.nodes.length} / ${nodes.data.capacity}` : '…'}</Badge>
	{/snippet}

	<Table>
		<thead>
			<tr
				><th>Name</th><th>Device</th><th>Node</th><th>Network</th><th>Battery</th><th>Last seen</th
				><th></th></tr
			>
		</thead>
		<tbody>
			{#if !nodes.data}
				<tr
					><td colspan="7" class={nodes.error ? 'text-err' : 'text-muted'}
						>{nodes.error ?? 'Loading…'}</td
					></tr
				>
			{:else}
				{#each nodes.data.nodes as n (n.id)}
					<tr>
						<td>
							<strong>{n.name || 'Unnamed'}</strong>
							<div class="text-muted">{n.vendor} {n.product}</div>
							{#if n.tags.length}
								<div class="mt-1 flex flex-wrap gap-1">
									{#each n.tags as tag (tag)}<Badge>{tag}</Badge>{/each}
								</div>
							{/if}
						</td>
						<td>
							{#each n.endpoints as e (e.id)}
								<div>
									{DEVICE_TYPES[e.deviceType] ?? 'Type ' + hexId(e.deviceType)}
									<span class="text-muted">#{e.id}</span>
								</div>
							{:else}
								<span class="text-muted"
									>{[n.vendor, n.product].filter(Boolean).join(' ') || 'unknown'}</span
								>
							{/each}
						</td>
						<td class="font-mono text-xs">{hexId(n.id)}</td>
						<td>{n.network}</td>
						<td>
							{#if n.battery}
								{@const look = batteryLook(n.battery)}
								<span
									class="inline-flex items-center gap-1 whitespace-nowrap {look.cls}"
									title="Reported {fmtAgo(n.battery.age)} ago"
								>
									<look.icon size={16} />
									{n.battery.percent !== undefined ? `${n.battery.percent} %` : n.battery.level}
								</span>
							{:else}
								<span class="text-muted">–</span>
							{/if}
						</td>
						<td>
							{#if n.lastSeen === null}
								<span class="text-muted">never</span>
							{:else}
								<span class={n.lastSeen < 600 ? 'text-ok' : 'text-warn'}
									>{fmtAgo(n.lastSeen)} ago</span
								>
							{/if}
						</td>
						<td class="w-[1%] text-right">
							<Menu label="Actions for {n.name || 'device'}" icon items={actions(n)}>
								{#snippet trigger()}<EllipsisVertical size={16} />{/snippet}
							</Menu>
						</td>
					</tr>
				{:else}
					<tr><td colspan="7" class="text-muted">No devices yet – pair one below.</td></tr>
				{/each}
			{/if}
		</tbody>
	</Table>

	<h3 class="mt-5 mb-2 text-sm">Add a device</h3>
	<form
		class="flex flex-wrap items-end gap-2 [&>label]:m-0 [&>label]:min-w-[140px] [&>label]:flex-1 [&>label:first-child]:min-w-[200px] [&>label:first-child]:flex-2"
		onsubmit={startPairing}
	>
		<Input
			label="Setup code"
			bind:value={code}
			required
			placeholder="MT:… or 3497-011-2332"
			title="QR payload (MT:…) or the 11/21 digit code"
			autocomplete="off"
		/>
		<Input label="Name" name="name" maxlength={31} placeholder="Living room lamp" />
		<Select label="Network" name="network">
			<option value="thread">Thread (via BLE)</option>
			<option value="wifi">Wi-Fi (via BLE)</option>
			<option value="onnetwork">Already on network</option>
		</Select>
		<Button type="submit" variant="primary" disabled={pair.state === 'running'}>Pair</Button>
		<QrScanButton onscan={(payload) => (code = payload)} />
	</form>
	<div class="mt-2 text-sm">
		{#if pairError}
			<span class="text-err">{pairError}</span>
		{:else if pair.state === 'running'}
			<span class="text-warn"
				>Commissioning node {hexId(pair.nodeId ?? 0)}… {pair.elapsed ?? 0} s</span
			>
		{:else if pair.state === 'success'}
			<span class="text-ok">Device commissioned as node {hexId(pair.nodeId ?? 0)}.</span>
		{:else if pair.state === 'failed'}
			<span class="text-err">Commissioning failed: {pair.error}</span>
		{/if}
	</div>
</Panel>
