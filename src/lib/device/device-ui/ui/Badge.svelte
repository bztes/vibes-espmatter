<!-- A small status pill; with `onclick` it is a button. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { tv } from 'tailwind-variants/lite';

	const badge = tv({
		base: 'inline-flex items-center gap-1 rounded-full border bg-bg px-2 py-px text-xs font-normal whitespace-nowrap',
		variants: {
			tone: {
				default: '',
				accent: 'text-accent',
				ok: 'text-ok',
				warn: 'text-warn',
				err: 'text-err'
			},
			button: { true: 'cursor-pointer' }
		}
	});

	let {
		tone = 'default',
		onclick,
		children,
		...rest
	}: Omit<HTMLAttributes<HTMLElement>, 'onclick'> & {
		tone?: 'default' | 'accent' | 'ok' | 'warn' | 'err';
		onclick?: () => void;
		children: Snippet;
	} = $props();
</script>

{#if onclick}
	<button type="button" class={badge({ tone, button: true })} {onclick} {...rest}
		>{@render children()}</button
	>
{:else}
	<span class={badge({ tone })} {...rest}>{@render children()}</span>
{/if}
