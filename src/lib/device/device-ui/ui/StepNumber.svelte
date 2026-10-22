<!-- A numbered circle, e.g. for steps. `active` fills it, `done` shows a check mark. -->
<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import { tv } from 'tailwind-variants/lite';

	const step = tv({
		base: 'grid size-[26px] shrink-0 place-items-center rounded-full border text-sm font-semibold',
		variants: {
			state: {
				todo: 'bg-bg',
				active: 'border-accent bg-accent text-white',
				done: 'bg-bg text-ok'
			}
		}
	});

	let {
		n,
		active = false,
		done = false
	}: { n: number; active?: boolean; done?: boolean } = $props();
</script>

<span class={step({ state: active ? 'active' : done ? 'done' : 'todo' })}>
	{#if done && !active}<Check size={14} />{:else}{n}{/if}
</span>
