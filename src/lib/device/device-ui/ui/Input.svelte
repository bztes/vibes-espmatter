<!-- Text input; with `label` it gets the label text above it. -->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { control } from './control.ts';
	import Field from './Field.svelte';

	let {
		value = $bindable(),
		label,
		class: className,
		...rest
	}: HTMLInputAttributes & { label?: string } = $props();
</script>

<Field {label}><input class={[control, className]} bind:value {...rest} /></Field>
