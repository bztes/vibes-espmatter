<!--
	New device: pick a template (or start empty, or continue the unsaved draft). The configurator
	opens at /device with the choice in the history state, so Back returns here.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button, Panel, showConfirm } from '#lib/device/device-ui/ui/index.ts';
	import { clearDraft, readDraft } from '#lib/draft.ts';
	import { templateName } from '#lib/device/generator.ts';
	import { boards, features, templates } from '#lib/device/registry.ts';
	import type { ProjectConfig } from '#lib/device/types.ts';

	/** The unsaved project, kept by the configurator until it is saved. */
	let draft = $state.raw<ProjectConfig | null>(null);

	onMount(() => (draft = readDraft()));

	async function start(template: string) {
		if (template !== 'draft') {
			const discard =
				!draft ||
				(await showConfirm('Discard draft', `Discard the unsaved device “${draft.name}”?`, {
					action: 'Discard',
					danger: true
				}));
			if (!discard) return;
			clearDraft();
		}
		goto(resolve('/device'), { state: { newDevice: { template } } });
	}

	/** A template card: the button at the bottom. */
	const template = 'flex flex-col items-start gap-2 [&>:last-child]:mt-auto';
</script>

<div>
	{#if draft}
		<Panel class="mb-4 flex flex-wrap items-center justify-between gap-3 border-accent">
			<div>
				<strong class="font-medium text-fg">Continue “{draft.name}”</strong>
				<p class="m-0 text-xs text-muted">
					Unsaved · {templateName(draft)} · {draft.chips.length}
					{draft.chips.length === 1 ? 'board' : 'boards'}
				</p>
			</div>
			<Button variant="primary" onclick={() => start('draft')}>Continue</Button>
		</Panel>
	{/if}

	<div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
		<Panel class={template}>
			<h2 class="m-0 text-md">Empty device</h2>
			<p class="m-0 text-muted">One board, no features – add them yourself.</p>
			<Button variant="primary" onclick={() => start('empty')}>Start empty</Button>
		</Panel>

		{#each templates.all() as t (t.id)}
			<Panel class={template}>
				<h2 class="m-0 text-md">{t.name}</h2>
				<p class="m-0 text-muted">{t.tagline}</p>
				<ul class="m-0 flex-1 list-none p-0 text-xs text-muted">
					{#each t.chips as chip (chip.id)}
						<li>
							<strong class="font-medium text-fg">{chip.name}</strong> ({boards.find(chip.board)
								?.name}):
							{Object.keys(chip.features)
								.map((id) => features.find(id)?.name ?? id)
								.join(', ')}
						</li>
					{/each}
				</ul>
				<Button variant="primary" onclick={() => start(t.id)}>Use template</Button>
			</Panel>
		{/each}
	</div>
</div>
