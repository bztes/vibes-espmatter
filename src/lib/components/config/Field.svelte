<!-- A setting with its label, help and issue; `children` renders the control with the `id`. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Help from './Help.svelte';

	let {
		label,
		help,
		error,
		children
	}: {
		label: string;
		help?: string;
		error?: string;
		children: Snippet<[{ id: string; invalid: 'true' | undefined }]>;
	} = $props();

	const id = $props.id();
</script>

<div>
	<div class="mb-0.5 flex items-center gap-1.5">
		<label for={id}>{label}</label>
		<Help text={help} />
	</div>
	{@render children({ id, invalid: error ? 'true' : undefined })}
	{#if error}<p class="m-0 text-xs text-err">{error}</p>{/if}
</div>
