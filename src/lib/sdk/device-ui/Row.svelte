<script lang="ts">
	import type { Snippet } from 'svelte';

	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<div
	class="flex items-baseline justify-between gap-4 border-b border-border py-1.5 text-sm last:border-0"
>
	<span class="text-muted">{label}</span>
	<span class="min-w-0 truncate text-right font-medium">{@render children()}</span>
</div>
