<!-- A heading that can be edited in place (looks like text until hovered or focused). -->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { tv } from 'tailwind-variants/lite';

	const title = tv({
		base: 'w-full min-w-[120px] rounded-none border-0 border-b border-b-transparent bg-transparent p-0 outline-none hover:border-b-border focus:border-b-accent',
		variants: {
			large: { true: 'text-[24px] font-bold', false: 'text-[17px] font-semibold' }
		}
	});

	let {
		value = $bindable(),
		large = false,
		...rest
	}: HTMLInputAttributes & { large?: boolean } = $props();
</script>

<input class={title({ large })} bind:value {...rest} />
