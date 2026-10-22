<!-- Settings side by side, as many as fit in a row. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="mt-0.5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-x-3 gap-y-2.5">
	{@render children()}
</div>
