<!-- `FieldBox`es side by side. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
	{@render children()}
</div>
