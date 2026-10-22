<!-- Pick a feature to add to a board: every feature it doesn't have yet, unavailable ones disabled with the reason. -->
<script lang="ts">
	import { canAddFeature } from '#lib/device/generator.ts';
	import { features } from '#lib/device/registry.ts';
	import type { ChipConfig, ProjectConfig } from '#lib/device/types.ts';
	import { Button, Dialog } from '#lib/device/device-ui/ui/index.ts';

	let {
		project,
		onadd
	}: { project: ProjectConfig; onadd: (chip: ChipConfig, id: string) => void } = $props();

	let dialog = $state<ReturnType<typeof Dialog>>();
	let chip = $state<ChipConfig>();

	const choices = $derived(
		chip
			? features
					.all()
					.filter((f) => !f.always && !(f.id in chip!.features))
					.map((f) => ({ feature: f, issue: canAddFeature(chip!, f, project) }))
					.sort((a, b) => Number(!!a.issue) - Number(!!b.issue))
			: []
	);

	export function open(target: ChipConfig) {
		chip = target;
		dialog?.open();
	}

	function pick(id: string) {
		if (chip) onadd(chip, id);
		dialog?.close();
	}
</script>

<Dialog bind:this={dialog} width={520}>
	<h2 class="mt-0 mb-3 text-[16px]">Add a feature to {chip?.name}</h2>
	{#if choices.length}
		<ul class="m-0 grid max-h-[60vh] list-none gap-1.5 overflow-auto p-0">
			{#each choices as { feature, issue } (feature.id)}
				<li>
					<button
						class="group grid w-full cursor-pointer justify-stretch justify-items-start gap-0.5 rounded-[10px] border bg-card px-3 py-2.5 text-left hover:not-disabled:border-accent disabled:cursor-default disabled:opacity-50"
						disabled={!!issue}
						onclick={() => pick(feature.id)}
					>
						<strong>{feature.name}</strong>
						<span class="m-0 text-xs text-muted group-disabled:text-warn"
							>{issue ?? feature.description}</span
						>
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-muted">This board has every feature.</p>
	{/if}
	<div class="mt-3 flex justify-end"><Button onclick={() => dialog?.close()}>Cancel</Button></div>
</Dialog>
