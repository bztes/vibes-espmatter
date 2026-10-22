<!--
	Admin dashboard: whom each scene is shared with (espm_scenes.cpp). Users it's shared with see it
	on their dashboard and may run it – all of its lights, also those they don't get otherwise – but
	not change it.
-->
<script lang="ts">
	import { api, errorMessage } from '../../web-ui/device-ui/api';
	import { live } from '../../web-ui/device-ui/live.svelte';
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import { Alert, Button, Chip } from '../../../device-ui/ui';
	import { summary, type ScenesResponse } from './scenes';

	const users = live<{ users: { name: string; role: 'admin' | 'user' }[] }>('/api/users', 60_000);
	const scenes = live<ScenesResponse>('/api/scenes', 60_000);

	const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
	const names = $derived((users.data?.users ?? []).map((u) => u.name).sort(byName));
	const sorted = $derived(
		[...(scenes.data?.scenes ?? [])].sort(
			(a, b) => byName(a.owner, b.owner) || byName(a.name, b.name)
		)
	);

	/** Unsaved selections per scene. */
	let edits = $state<Record<number, string[]>>({});
	let error = $state('');
	let busy = $state(false);

	async function save(id: number) {
		busy = true;
		error = '';
		try {
			await api('/api/scenes', { body: { op: 'share', id, users: edits[id].join(',') } });
			await scenes.refresh();
			delete edits[id];
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<Panel title="Scene sharing">
	{#if !scenes.data}
		<p class="text-muted">{scenes.error ?? 'Loading…'}</p>
	{:else if sorted.length === 0}
		<p class="text-muted">No scenes yet – everyone creates their own on the dashboard.</p>
	{:else if names.length < 2}
		<p class="text-muted">No other users to share scenes with yet.</p>
	{/if}
	{#each names.length >= 2 ? sorted : [] as scene (scene.id)}
		{@const saved = scene.shared ?? []}
		{@const selected = edits[scene.id] ?? saved}
		{@const others = names.filter((n) => n !== scene.owner)}
		<div class="grid gap-2 border-t py-3">
			<div class="flex flex-wrap items-center gap-2">
				<strong>{scene.name}</strong>
				<span class="text-muted"
					>· by {scene.owner} · {summary(scene)}{saved.length ? '' : ' · not shared'}</span
				>
			</div>
			<div class="flex flex-wrap gap-1.5">
				{#each others as user (user)}
					{@const on = selected.includes(user)}
					<Chip
						pressed={on}
						onclick={() =>
							(edits[scene.id] = on ? selected.filter((u) => u !== user) : [...selected, user])}
						>{user}</Chip
					>
				{/each}
			</div>
			{#if edits[scene.id]}
				<!-- Quiet links, the toggles stay the focus. -->
				<div class="flex flex-wrap items-center gap-3 text-sm">
					<Button variant="link" onclick={() => save(scene.id)} disabled={busy}>Save sharing</Button
					>
					<Button variant="link" tone="muted" onclick={() => delete edits[scene.id]}>Cancel</Button>
				</div>
			{/if}
		</div>
	{/each}
	{#if error}<Alert>{error}</Alert>{/if}
</Panel>
