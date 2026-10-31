<!--
	Admin dashboard: the lights and sensors each user (not admin) sees on the user dashboard, and
	whether they may control a light or only view it (espm_matter_access.cpp). Admins see and
	control all of them anyway.
-->
<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import { api, errorMessage } from '../../web-ui/device-ui/api';
	import { live } from '../../web-ui/device-ui/live.svelte';
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import { Alert, Button, Chip } from '../../../device-ui/ui';
	import { LIGHT_TYPES, SENSOR_TYPES, endpointName, matterNodes, nodeName } from './matter';

	type Light = { node: number; endpoint: number; readOnly?: boolean };
	type Level = 'control' | 'view';
	/** Endpoint key ("node:endpoint") → what the user may do with it; missing: not shown to them. */
	type Selection = Record<string, Level>;

	const users = live<{ users: { name: string; role: 'admin' | 'user' }[] }>('/api/users', 60_000);
	const access = live<{ max: number; users: Record<string, Light[]> }>(
		'/api/matter/access',
		60_000
	);
	const nodes = matterNodes();

	/**
	 * One choice per light, and one per sensor device covering all of its sensor endpoints. Sensors
	 * have nothing to control: they are only shown or not.
	 */
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
							name: endpointName(node, ep, 'light'),
							controllable: true
						})),
					...(sensorKeys.length
						? [
								{
									key: `${node.id}:sensors`,
									keys: sensorKeys,
									name: nodeName(node),
									controllable: false
								}
							]
						: [])
				];
			})
			.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
	);
	const members = $derived((users.data?.users ?? []).filter((u) => u.role === 'user'));
	const selectionOf = (user: string): Selection =>
		Object.fromEntries(
			(access.data?.users[user] ?? []).map((l) => [
				`${l.node}:${l.endpoint}`,
				l.readOnly ? 'view' : 'control'
			])
		);

	/** Unsaved selections per user. */
	let edits = $state<Record<string, Selection>>({});
	let error = $state('');
	let busy = $state(false);

	/** The level of a choice; for sensor devices that of their first endpoint (all are set alike). */
	const levelOf = (sel: Selection, keys: string[]): Level | undefined =>
		keys.every((k) => sel[k]) ? sel[keys[0]] : undefined;

	/** Lights: off → control → view only → off. Sensors: off ↔ shown. */
	function next(sel: Selection, l: (typeof lights)[number]): Selection {
		const level = levelOf(sel, l.keys);
		const to: Level | undefined = !level
			? 'control'
			: level === 'control' && l.controllable
				? 'view'
				: undefined;
		const out = { ...sel };
		for (const k of l.keys) {
			if (to) out[k] = to;
			else delete out[k];
		}
		return out;
	}

	async function save(user: string) {
		busy = true;
		error = '';
		const keys = (level: Level) =>
			Object.entries(edits[user])
				.filter(([, l]) => l === level)
				.map(([k]) => k)
				.join(',');
		try {
			await api('/api/matter/access', {
				body: { user, lights: keys('control'), view: keys('view') }
			});
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
	{:else}
		<p class="text-sm text-muted">
			Tap a light once to let the user control it, a second time to let them only view it (<Eye
				size={13}
				class="inline align-[-2px]"
			/>).
		</p>
	{/if}
	{#each lights.length ? members : [] as user (user.name)}
		{@const saved = selectionOf(user.name)}
		{@const selected = edits[user.name] ?? saved}
		{@const count = lights.filter((l) => levelOf(saved, l.keys)).length}
		<div class="grid gap-2 border-t py-3">
			<div class="flex flex-wrap items-center gap-2">
				<strong>{user.name}</strong>
				<span class="text-muted">· {count} device{count === 1 ? '' : 's'}</span>
			</div>
			<!-- The saved ones first – by the saved selection, so a light doesn't jump when clicked. -->
			<div class="flex flex-wrap gap-1.5">
				{#each [...lights.filter( (l) => levelOf(saved, l.keys) ), ...lights.filter((l) => !levelOf(saved, l.keys))] as l (l.key)}
					{@const level = levelOf(selected, l.keys)}
					<Chip
						pressed={!!level}
						title={level === 'view' ? 'View only' : level && l.controllable ? 'Control' : undefined}
						onclick={() => (edits[user.name] = next(selected, l))}
						>{#if level === 'view'}<Eye
								size={13}
								class="mr-1"
								aria-label="View only:"
							/>{/if}{l.name}</Chip
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
