<!-- A message box: errors (`err`, default) or information (`info`). -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { tv } from 'tailwind-variants/lite';

	const alert = tv({
		base: 'rounded-lg border px-3 py-2.5 text-sm whitespace-pre-line [&_ul]:m-0 [&_ul]:pl-[18px]',
		variants: {
			tone: {
				err: 'border-err/35 bg-err/8 text-err',
				info: 'border-accent/35 bg-accent/8 text-fg'
			}
		}
	});

	let { tone = 'err', children }: { tone?: 'err' | 'info'; children: Snippet } = $props();
</script>

<div class={alert({ tone })} role={tone === 'err' ? 'alert' : undefined}>{@render children()}</div>
