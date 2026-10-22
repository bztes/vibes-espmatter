<!-- Select; with `label` it gets the label text above it. -->
<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import { control } from './control.ts';
	import Field from './Field.svelte';

	let {
		value = $bindable(),
		label,
		class: className,
		children,
		...rest
	}: HTMLSelectAttributes & { label?: string } = $props();
</script>

<Field {label}
	><select class={[control, className]} bind:value {...rest}>{@render children?.()}</select></Field
>
