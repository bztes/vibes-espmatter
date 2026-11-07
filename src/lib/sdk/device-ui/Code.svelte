<!-- Inline code: names, paths, commands in running text. -->
<script lang="ts" module>
	import { tv } from 'tailwind-variants';

	export const code = tv({ base: 'font-mono text-[0.9em]' });
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	let { class: className, children }: { class?: string; children: Snippet } = $props();
</script>

<code class={code({ class: className })}>{@render children()}</code>
