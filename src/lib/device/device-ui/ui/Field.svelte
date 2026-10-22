<!-- With `label`: the label text above a form control (children). Used by Input, Select, …. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { label, children }: { label?: string; children: Snippet } = $props();
</script>

{#if label}
	<label class="mb-2.5 block">
		<span class="mb-0.5 block text-xs text-muted">{label}</span>
		{@render children()}
	</label>
{:else}
	{@render children()}
{/if}
