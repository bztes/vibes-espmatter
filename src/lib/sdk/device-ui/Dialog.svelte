<!--
  A modal dialog (native `<dialog>`): content is only rendered while open, so forms start fresh.
  With `onsubmit`, body and footer are one form – the footer's submit button sends it.
-->
<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import Button from './Button.svelte';
	import type { Snippet } from 'svelte';
	import { tv } from 'tailwind-variants';

	let {
		open = $bindable(false),
		title,
		wide = false,
		children,
		footer,
		onsubmit,
		onclose
	}: {
		open?: boolean;
		title: string;
		wide?: boolean;
		children: Snippet;
		footer?: Snippet;
		onsubmit?: () => void;
		onclose?: () => void;
	} = $props();

	let el = $state<HTMLDialogElement>();

	$effect(() => {
		if (!el) return;
		if (open && !el.open) el.showModal();
		else if (!open && el.open) el.close();
	});

	function closed() {
		if (!open) return;
		open = false;
		onclose?.();
	}

	const dialog = tv({
		base: 'm-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-card border border-border bg-surface p-0 text-fg shadow-xl backdrop:bg-black/40',
		variants: { wide: { true: 'max-w-2xl' } }
	});
</script>

{#snippet body()}
	<header class="flex items-center gap-3 border-b border-border px-4 py-3">
		<h2 class="m-0 min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
		<Button
			variant="ghost"
			size="icon"
			class="text-muted hover:text-fg"
			aria-label="Close"
			onclick={closed}><X size={18} /></Button
		>
	</header>
	<div class="min-h-0 flex-1 overflow-y-auto p-4">{@render children()}</div>
	{#if footer}
		<footer
			class="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2/50 px-4 py-3"
		>
			{@render footer()}
		</footer>
	{/if}
{/snippet}

<!-- A click on the backdrop lands on the dialog element itself. -->
<dialog
	bind:this={el}
	class={dialog({ wide })}
	onclose={closed}
	onclick={(e) => e.target === el && closed()}
>
	{#if open}
		{#if onsubmit}
			<form
				class="flex max-h-[calc(100dvh-2rem)] flex-col"
				onsubmit={(e) => (e.preventDefault(), onsubmit())}
			>
				{@render body()}
			</form>
		{:else}
			<div class="flex max-h-[calc(100dvh-2rem)] flex-col">{@render body()}</div>
		{/if}
	{/if}
</dialog>
