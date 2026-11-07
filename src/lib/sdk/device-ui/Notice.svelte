<script lang="ts">
	import { tv } from 'tailwind-variants';
	import type { Snippet } from 'svelte';

	let { tone = 'info', children }: { tone?: 'info' | 'ok' | 'warn' | 'err'; children: Snippet } =
		$props();

	const notice = tv({
		base: 'rounded-lg px-3 py-2 text-sm',
		variants: {
			tone: {
				info: 'bg-info-soft text-info',
				ok: 'bg-ok-soft text-ok',
				warn: 'bg-warn-soft text-warn',
				err: 'bg-err-soft text-err'
			}
		}
	});
</script>

<div class={notice({ tone })} role={tone === 'err' ? 'alert' : 'status'}>{@render children()}</div>
