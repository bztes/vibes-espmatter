<!--
  A group of settings under a title. With `enabled`, the title has an on/off switch and the
  settings are shown only while it is on.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Switch } from '#lib/device/device-ui/ui/index.ts';

	let {
		title,
		enabled = $bindable(),
		help,
		children
	}: {
		title: string;
		enabled?: boolean;
		/** Tooltip of the switch. */
		help?: string;
		children?: Snippet;
	} = $props();
</script>

<section class="grid content-start gap-2.5 rounded-lg border px-3 pt-2.5 pb-3">
	<div class="flex items-center justify-between gap-2">
		<h4 class="m-0 text-sm">{title}</h4>
		{#if enabled !== undefined}
			<Switch aria-label={title} title={help ?? title} bind:checked={enabled} />
		{/if}
	</div>
	{#if enabled !== false}{@render children?.()}{/if}
</section>
