<!-- A modal on top of the page (native <dialog>). -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '#sdk/device-ui';

	let {
		open = $bindable(false),
		title,
		wide = false,
		children,
		footer
	}: {
		open?: boolean;
		title: string;
		wide?: boolean;
		children: Snippet;
		footer?: Snippet;
	} = $props();

	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	onclose={() => (open = false)}
	onclick={(e) => e.target === dialog && (open = false)}
	class={[
		'm-auto w-[calc(100%-2rem)] rounded-card border border-border bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-[2px]',
		wide ? 'max-w-3xl' : 'max-w-lg'
	]}
>
	{#if open}
		<header class="flex items-center justify-between border-b border-border px-5 py-3.5">
			<h2 class="m-0 text-base font-semibold">{title}</h2>
			<Button
				variant="ghost"
				size="icon"
				class="text-muted hover:text-fg"
				aria-label="Close"
				onclick={() => (open = false)}><X size={18} /></Button
			>
		</header>
		<div class="max-h-[70vh] overflow-y-auto p-5">{@render children()}</div>
		{#if footer}<footer class="flex justify-end gap-2 border-t border-border px-5 py-3">
				{@render footer()}
			</footer>{/if}
	{/if}
</dialog>
