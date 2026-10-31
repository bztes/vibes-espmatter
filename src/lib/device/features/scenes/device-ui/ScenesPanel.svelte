<!--
	Scenes on the dashboard (espm_scenes.cpp): one tile per scene, tap to switch its lights. Everyone
	sees their own scenes and those an admin shared with them; only the owner edits or deletes one.
-->
<script lang="ts">
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { api, errorMessage } from '../../web-ui/device-ui/api';
	import { auth } from '../../web-ui/device-ui/auth.svelte';
	import { live } from '../../web-ui/device-ui/live.svelte';
	import Menu from '../../../device-ui/Menu.svelte';
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import { Alert, Button, showConfirm } from '../../../device-ui/ui';
	import { LIGHT_TYPES, endpointName, matterNodes } from '../../matter-controller/device-ui/matter';
	import SceneDialog from './SceneDialog.svelte';
	import { summary, type LightChoice, type Scene, type ScenesResponse } from './scenes';

	const scenes = live<ScenesResponse>('/api/scenes', 30_000);
	const nodes = matterNodes();

	const lights = $derived<LightChoice[]>(
		(nodes.data?.nodes ?? [])
			.flatMap((node) =>
				node.endpoints
					.filter((ep) => LIGHT_TYPES.includes(ep.deviceType) && !ep.readOnly)
					.map((endpoint) => ({
						key: `${node.id}:${endpoint.id}`,
						node: node.id,
						name: endpointName(node, endpoint, 'light'),
						endpoint
					}))
			)
			.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
	);

	const me = $derived(auth.session?.user ?? '');
	const isAdmin = $derived(auth.session?.role === 'admin');
	// Admins get everyone's scenes: their dashboard shows only their own and those shared with them.
	const mine = (s: Scene) => s.owner === me;
	const shown = $derived(
		(scenes.data?.scenes ?? [])
			.filter((s) => !isAdmin || mine(s) || s.shared?.includes(me))
			.sort(
				(a, b) =>
					Number(mine(b)) - Number(mine(a)) ||
					a.name.localeCompare(b.name, undefined, { numeric: true })
			)
	);

	let dialog = $state<SceneDialog>();
	let error = $state('');
	/** The scene that was just run, for a moment of feedback. */
	let running = $state<number>();
	let ran = $state<number>();

	async function run(s: Scene) {
		error = '';
		running = s.id;
		try {
			await api('/api/scenes', { body: { op: 'run', id: s.id } });
			ran = s.id;
			setTimeout(() => {
				if (ran === s.id) ran = undefined;
			}, 1500);
			// The tiles show the new state once the lights report it.
			setTimeout(() => nodes.refresh(), 1500);
		} catch (e) {
			error = errorMessage(e);
		} finally {
			running = undefined;
		}
	}

	async function remove(s: Scene) {
		const ok = await showConfirm('Delete scene', `Delete the scene “${s.name}”?`, {
			action: 'Delete',
			danger: true
		});
		if (!ok) return;
		error = '';
		try {
			await api('/api/scenes', { body: { op: 'delete', id: s.id } });
			await scenes.refresh();
		} catch (e) {
			error = errorMessage(e);
		}
	}
</script>

<Panel title="Scenes">
	{#snippet badge()}
		{#if lights.length && scenes.data && scenes.data.count < scenes.data.max}
			<Button onclick={() => dialog?.open()}><Plus size={15} /> New scene</Button>
		{/if}
	{/snippet}

	{#if !scenes.data}
		<p class="text-muted">{scenes.error ?? 'Loading…'}</p>
	{:else if shown.length === 0}
		<p class="text-muted">
			{lights.length ? 'No scenes yet.' : 'No lights you could make a scene of.'}
		</p>
	{:else}
		<div class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
			{#each shown as s (s.id)}
				<div class="flex items-center gap-1 rounded-[10px] border bg-bg pr-1">
					<button
						type="button"
						class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent p-3 text-left disabled:cursor-default"
						disabled={running !== undefined}
						title="Switch the lights of this scene"
						onclick={() => run(s)}
					>
						<span
							class={[
								'grid size-9 shrink-0 place-items-center rounded-full',
								ran === s.id ? 'bg-accent text-white' : 'bg-card text-accent'
							]}
						>
							<Sparkles size={18} />
						</span>
						<span class="grid min-w-0">
							<strong class="truncate">{s.name}</strong>
							<span class="truncate text-xs text-muted">
								{running === s.id ? 'Switching…' : ran === s.id ? 'Done' : summary(s)}{mine(s)
									? ''
									: ` · from ${s.owner}`}
							</span>
						</span>
					</button>
					{#if mine(s) || isAdmin}
						<Menu
							label="Actions for this scene"
							icon
							variant="ghost"
							items={[
								{ label: 'Edit', icon: Pencil, onclick: () => dialog?.open(s) },
								{ label: 'Delete', icon: Trash2, danger: true, onclick: () => remove(s) }
							]}
						>
							{#snippet trigger()}<EllipsisVertical size={16} />{/snippet}
						</Menu>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
	{#if error}<Alert>{error}</Alert>{/if}
</Panel>

<SceneDialog
	bind:this={dialog}
	{lights}
	maxLights={scenes.data?.maxLights ?? 12}
	onsaved={scenes.refresh}
/>
