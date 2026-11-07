<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		help,
		error,
		warning,
		id,
		extra,
		children
	}: {
		label: string;
		help?: string;
		error?: string;
		warning?: string;
		id?: string;
		/** Next to the label. */
		extra?: Snippet;
		children: Snippet;
	} = $props();
</script>

<div class="grid content-start gap-1.5">
	<label for={id} class="text-sm font-medium">{label}{@render extra?.()}</label>
	{@render children()}
	{#if error}<p class="m-0 text-xs text-err">{error}</p>
	{:else if warning}<p class="m-0 text-xs text-warn">{warning}</p>
	{:else if help}<p class="m-0 text-xs text-muted">{help}</p>{/if}
</div>
