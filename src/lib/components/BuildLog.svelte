<!-- The log of a build, as a dialog. Open with `bind:this={d}` → `d.open()`. -->
<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { resolve } from '$app/paths';
	import { buildState } from '#lib/api/builds.remote.ts';
	import { Button, Dialog, Log } from '#lib/device/device-ui/ui/index.ts';

	let { buildId }: { buildId: string } = $props();

	const build = $derived(await buildState(buildId));

	let dialog = $state<ReturnType<typeof Dialog>>();

	export function open() {
		dialog?.open();
	}
</script>

<Dialog bind:this={dialog} width={1000}>
	<div class="grid grid-cols-[minmax(0,1fr)] gap-3">
		<header class="flex flex-wrap items-center gap-2">
			<h2 class="m-0 text-lg">Build log</h2>
			<a
				class="text-muted"
				href={resolve('/api/builds/[id]/[...file]', { id: build.id, file: 'build.log' })}
				target="_blank">full log</a
			>
			<Button variant="link" icon class="ml-auto" aria-label="Close" onclick={() => dialog?.close()}
				><X size={18} /></Button
			>
		</header>
		<Log lines={build.log} height={560} empty="Waiting for the build to start…" />
	</div>
</Dialog>
