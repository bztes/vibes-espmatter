<!--
	Admin dashboard: the lights and sensors each user (not admin) sees and controls on the user
	dashboard (espm_matter_access.cpp). Admins see all of them anyway.
-->
<script lang="ts">
	import { api, errorMessage } from '../../web-ui/device-ui/api';
	import { live } from '../../web-ui/device-ui/live.svelte';
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import { Alert, Button, Chip } from '../../../device-ui/ui';
	import { LIGHT_TYPES, SENSOR_TYPES, endpointName, matterNodes, nodeName } from './matter';

	type Light = { node: number; endpoint: number };

	const users = live<{ users: { name: string; role: 'admin' | 'user' }[] }>('/api/users', 60_000);
	const access = live<{ max: number; users: Record<string, Light[]> }>(
		'/api/matter/access',
		60_000
	);
	const nodes = matterNodes();

	/** One choice per light, and one per sensor device covering all of its sensor endpoints. */
	const lights = $derived(
		(nodes.data?.nodes ?? [])
			.flatMap((node) => {
				const sensorKeys = node.endpoints
					.filter((ep) => SENSOR_TYPES.includes(ep.deviceType))
					.map((ep) => `${node.id}:${ep.id}`);
				return [
					...node.endpoints
						.filter((ep) => LIGHT_TYPES.includes(ep.deviceType))
						.map((ep) => ({
							key: `${node.id}:${ep.id}`,
							keys: [`${node.id}:${ep.id}`],
							name: endpointName(node, ep, 'light')
						})),
					...(sensorKeys.length
						? [{ key: `${node.id}:sensors`, keys: sensorKeys, name: nodeName(node) }]
						: [])
				];
			})
			.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
	);
	const members = $derived((users.data?.users ?? []).filter((u) => u.role === 'user'));
	const keysOf = (user: string) =>
		(access.data?.users[user] ?? []).map((l) => `${l.node}:${l.endpoint}`);

	/** Unsaved light selections per user. */
	let edits = $state<Record<string, string[]>>({});
	let error = $state('');
	let busy = $state(false);

	function toggle(list: string[], keys: string[], on: boolean) {
		return on ? [...new Set([...list, ...keys])] : list.filter((k) => !keys.includes(k));
	}
	const isIn = (list: string[], keys: string[]) => keys.every((k) => list.includes(k));

	async function save(user: string) {
		busy = true;
		error = '';
		try {
			await api('/api/matter/access', { body: { user, lights: edits[user].join(',') } });
			await access.refresh();
			delete edits[user];
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<Panel title="Dashboard access">
	{#if members.length === 0}
		<p class="text-muted">
			No users yet – admins see every light and sensor. Add a user with the role “User” to give them
			some.
		</p>
	{:else if lights.length === 0}
		<p class="text-muted">No lights or sensors paired yet.</p>
	{/if}
	{#each lights.length ? members : [] as user (user.name)}
		{@const saved = keysOf(user.name)}
		{@const selected = edits[user.name] ?? saved}
		{@const count = lights.filter((l) => isIn(saved, l.keys)).length}
		<div class="grid gap-2 border-t py-3">
			<div class="flex flex-wrap items-center gap-2">
				<strong>{user.name}</strong>
				<span class="text-muted">· {count} device{count === 1 ? '' : 's'}</span>
			</div>
			<!-- The saved ones first – by the saved selection, so a light doesn't jump when clicked. -->
			<div class="flex flex-wrap gap-1.5">
				{#each [...lights.filter( (l) => isIn(saved, l.keys) ), ...lights.filter((l) => !isIn(saved, l.keys))] as l (l.key)}
					{@const on = isIn(selected, l.keys)}
					<Chip pressed={on} onclick={() => (edits[user.name] = toggle(selected, l.keys, !on))}
						>{l.name}</Chip
					>
				{/each}
			</div>
			{#if edits[user.name]}
				<!-- Quiet links, the toggles stay the focus. -->
				<div class="flex flex-wrap items-center gap-3 text-sm">
					<Button variant="link" onclick={() => save(user.name)} disabled={busy}
						>Save selection</Button
					>
					<Button variant="link" tone="muted" onclick={() => delete edits[user.name]}>Cancel</Button
					>
				</div>
			{/if}
		</div>
	{/each}
	{#if error}<Alert>{error}</Alert>{/if}
</Panel>
