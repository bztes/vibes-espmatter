<script lang="ts" module>
	import { tv } from 'tailwind-variants';

	export const card = tv({
		slots: {
			root: 'rounded-card border border-border bg-surface shadow-card',
			header: 'flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-3.5',
			title: 'm-0 text-sm font-semibold',
			description: 'mt-0.5 mb-0 text-xs text-muted',
			body: 'p-5'
		},
		variants: {
			tone: {
				default: {},
				err: { root: 'border-err/40' },
				muted: { root: 'bg-surface-2/60 shadow-none' }
			},
			flush: { true: { body: 'p-0' } }
		},
		defaultVariants: { tone: 'default' }
	});
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		actions,
		tone,
		flush = false,
		class: className,
		children
	}: {
		title?: string;
		description?: string;
		actions?: Snippet;
		tone?: 'default' | 'err' | 'muted';
		flush?: boolean;
		class?: string;
		children: Snippet;
	} = $props();
	const s = $derived(card({ tone, flush }));
</script>

<section class={s.root({ class: className })}>
	{#if title || actions}
		<header class={s.header()}>
			<div class="min-w-0">
				{#if title}<h2 class={s.title()}>{title}</h2>{/if}
				{#if description}<p class={s.description()}>{description}</p>{/if}
			</div>
			{@render actions?.()}
		</header>
	{/if}
	<div class={s.body()}>{@render children()}</div>
</section>
