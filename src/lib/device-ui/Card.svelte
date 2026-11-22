<script lang="ts">
	import type { Snippet } from 'svelte';
	import { tv } from 'tailwind-variants';
	import { provideCardHeader } from '#sdk/device-ui';

	let {
		title,
		wide = false,
		children
	}: { title: string; wide?: boolean; children: Snippet } = $props();

	const card = tv({
		slots: {
			root: 'min-w-0 rounded-card border border-border bg-surface p-4 shadow-card',
			header: 'mb-3 flex min-h-5 items-center gap-2',
			heading: 'm-0 min-w-0 flex-1'
		},
		variants: {
			wide: { true: { root: 'sm:col-span-2' } },
			custom: {
				true: { heading: 'text-base font-normal' },
				false: { heading: 'truncate text-xs font-semibold tracking-wide text-muted uppercase' }
			}
		}
	});
	const header = provideCardHeader();
	const s = $derived(card({ wide, custom: !!header.title }));
</script>

<section class={s.root()}>
	<div class={s.header()}>
		<h2 class={s.heading()}>
			{#if header.title}{@render header.title()}{:else}{title}{/if}
		</h2>
		{@render header.actions?.()}
	</div>
	{@render children()}
</section>
