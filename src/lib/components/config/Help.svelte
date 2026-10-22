<!-- A setting's help text as a tooltip: the cards stay short. -->
<script lang="ts">
	import Info from '@lucide/svelte/icons/info';

	let { text }: { text?: string } = $props();
</script>

{#if text}<span class="inline-flex cursor-help text-muted" title={text}><Info size={13} /></span
	>{/if}
