<script lang="ts">
	import type { Snippet } from 'svelte';
	import { tv } from 'tailwind-variants';

	let {
		title,
		wide = false,
		children
	}: { title: string; wide?: boolean; children: Snippet } = $props();

	const card = tv({
		slots: {
			root: 'min-w-0 rounded-card border border-border bg-surface p-4 shadow-card',
			heading: 'mt-0 mb-3 text-xs font-semibold tracking-wide text-muted uppercase'
		},
		variants: { wide: { true: { root: 'sm:col-span-2' } } }
	});
	const s = $derived(card({ wide }));
</script>

<section class={s.root()}>
	<h2 class={s.heading()}>{title}</h2>
	{@render children()}
</section>
