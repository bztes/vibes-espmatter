<!-- One row of a "Manage" card: what the action does on the left, its button on the right.
     With `confirm`, the button opens an inline confirmation below the row instead of acting. -->
<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '#lib/ui/index.ts';

	let {
		title,
		description,
		label,
		variant = 'secondary',
		confirm,
		confirmLabel = 'Yes, delete',
		blocked,
		onaction
	}: {
		title: string;
		description: string;
		label: string;
		variant?: 'secondary' | 'danger';
		/** Asked before acting. */
		confirm?: string;
		confirmLabel?: string;
		/** Why the action isn't possible right now – shown instead of the button. */
		blocked?: string;
		onaction: () => unknown;
	} = $props();

	let confirming = $state(false);
	let busy = $state(false);

	async function act() {
		busy = true;
		try {
			await onaction();
		} finally {
			busy = false;
			confirming = false;
		}
	}
</script>

<div class="grid gap-3 py-4 first:pt-0 last:pb-0">
	<div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
		<div class="min-w-0 flex-1 basis-60">
			<div class="text-sm font-medium">{title}</div>
			<div class="text-xs text-muted">{blocked ?? description}</div>
		</div>
		<Button
			{variant}
			disabled={!!blocked || confirming || busy}
			onclick={() => (confirm ? (confirming = true) : act())}>{label}</Button
		>
	</div>
	{#if confirming}
		<div
			class="flex flex-wrap items-center gap-3 rounded-lg border border-err/40 bg-err-soft px-4 py-3"
		>
			<TriangleAlert size={16} class="shrink-0 text-err" />
			<span class="min-w-0 flex-1 basis-48 text-sm">{confirm}</span>
			<div class="ml-auto flex gap-2">
				<Button variant="ghost" size="sm" disabled={busy} onclick={() => (confirming = false)}
					>Cancel</Button
				>
				<Button variant="danger" size="sm" disabled={busy} onclick={act}>{confirmLabel}</Button>
			</div>
		</div>
	{/if}
</div>
