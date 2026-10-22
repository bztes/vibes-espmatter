<!-- A data table: pass its `<thead>`/`<tbody>` as children. Scrolls sideways when too wide. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="overflow-x-auto">
	<table
		class="w-full border-collapse text-sm [&_:is(th,td)]:border-b [&_:is(th,td)]:px-2 [&_:is(th,td)]:py-1.5 [&_:is(th,td)]:align-top [&_th]:text-left [&_th]:font-medium [&_th]:text-muted"
	>
		{@render children()}
	</table>
</div>
