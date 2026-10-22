<!-- Notice that a build is of an older configuration than the one being edited. -->
<script lang="ts">
	import { buildState } from '#lib/api/builds.remote.ts';
	import { Alert, Button } from '#lib/device/device-ui/ui/index.ts';

	let {
		buildId,
		currentHash,
		onrebuild
	}: {
		buildId: string;
		/** `projectHash` of the configuration being edited. */
		currentHash: string;
		/** Offers to build again (absent: the caller has its own button). */
		onrebuild?: () => void;
	} = $props();

	const build = $derived(await buildState(buildId));
</script>

{#if build.projectHash !== currentHash}
	<Alert tone="info">
		The configuration changed since this build – the firmware doesn’t have the changes yet.
		{#if onrebuild}<Button variant="link" onclick={onrebuild}>Build again</Button>{/if}
	</Alert>
{/if}
