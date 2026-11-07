<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import { Button } from '#sdk/device-ui';

	let { text, label = 'Copy' }: { text: string; label?: string } = $props();
	let copied = $state(false);

	async function copy() {
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<Button
	variant="ghost"
	size="icon"
	class="size-7 shrink-0 rounded-md text-muted hover:text-fg"
	aria-label={label}
	title={label}
	onclick={copy}
>
	{#if copied}<Check size={15} class="text-ok" />{:else}<Copy size={15} />{/if}
</Button>
