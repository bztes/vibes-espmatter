<!--
  Scenes on the dashboard: one button each to activate it, highlighted while the devices are as it
  sets them. Made and edited on the automations page (ScenesWidget).
-->
<script lang="ts">
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { errorText, Notice, Poll } from '#sdk/device-ui';
	import type { Scene } from './automations';
	import { runScene } from './scenes';

	const scenes = new Poll<{ scenes: Scene[] }>('/api/v1/controller/scenes', 15000);
	const list = $derived((scenes.current?.scenes ?? []).filter((s) => s.members.length));

	let busy = $state(false);
	let status = $state<{ tone: 'err' | 'info'; text: string }>();

	async function activate(scene: Scene) {
		busy = true;
		status = undefined;
		try {
			const skipped = await runScene(scene.id);
			if (skipped)
				status = { tone: 'info', text: `${skipped} device(s) skipped: you may not control them.` };
			await scenes.refresh();
		} catch (e) {
			status = { tone: 'err', text: errorText(e) };
		} finally {
			busy = false;
		}
	}
</script>

{#if list.length}
	<section class="grid gap-2" aria-label="Scenes">
		<h3 class="m-0 px-1 text-base font-semibold">Scenes</h3>
		<div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
			{#each list as scene (scene.id)}
				<button
					type="button"
					aria-pressed={scene.active}
					disabled={busy}
					title={scene.active ? 'Active: the devices are as it sets them' : 'Activate'}
					class={[
						'flex min-h-20 flex-col items-start justify-between gap-2 rounded-xl border p-3 text-left transition-colors disabled:opacity-50',
						scene.active
							? 'border-accent bg-accent text-accent-fg hover:bg-accent/90'
							: 'border-border bg-surface text-fg hover:bg-surface-2'
					]}
					onclick={() => activate(scene)}
				>
					<span class="flex w-full items-start gap-2">
						<Sparkles size={18} class="mt-0.5 shrink-0" />
						<span class="line-clamp-2 text-base font-semibold">{scene.name}</span>
					</span>
					<span class={['text-xs', scene.active ? 'opacity-80' : 'text-muted']}>
						{scene.active ? 'On' : `${scene.members.length} device(s)`}{#if !scene.mine}
							· {scene.owner}{/if}
					</span>
				</button>
			{/each}
		</div>
		{#if status}<Notice tone={status.tone}>{status.text}</Notice>{/if}
	</section>
{:else if scenes.error}
	<p class="text-sm text-err">{scenes.error}</p>
{/if}
