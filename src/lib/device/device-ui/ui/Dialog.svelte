<!--
	A modal dialog. Open it with `bind:this={d}` → `d.open()`, close with `d.close()`; `onclose` runs
	however it closes (also Esc).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		width = 400,
		onclose,
		children
	}: { width?: number; onclose?: () => void; children: Snippet } = $props();

	let dialog = $state<HTMLDialogElement>();

	export function open() {
		dialog?.showModal();
	}
	export function close() {
		dialog?.close();
	}
</script>

<dialog
	bind:this={dialog}
	class="w-[min(var(--width),calc(100%_-_24px))] rounded-[14px] border bg-card p-5 text-fg backdrop:bg-black/40"
	style:--width="{width}px"
	{onclose}
>
	{@render children()}
</dialog>
