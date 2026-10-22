<!-- Multi-line text input; with `label` it gets the label text above it. -->
<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { control } from './control.ts';
	import Field from './Field.svelte';

	let {
		value = $bindable(),
		label,
		class: className,
		...rest
	}: HTMLTextareaAttributes & { label?: string } = $props();
</script>

<Field {label}
	><textarea class={[control, 'block resize-y', className]} bind:value {...rest}></textarea></Field
>
