<!-- Label–value pairs: pass `<dt>`/`<dd>` children, the labels get a column of their own. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<dl
	class="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 [&_dd]:m-0 [&_dd]:wrap-anywhere [&_dt]:text-muted"
>
	{@render children()}
</dl>
