<!-- One line about a build for the configurator's header: queued, compiling, ready or outdated. -->
<script lang="ts">
	import { buildState } from '#lib/api/builds.remote.ts';
	import type { BuildStatus } from '#lib/build-types.ts';

	let {
		buildId,
		currentHash
	}: {
		buildId: string;
		/** `projectHash` of the configuration being edited: an older build is marked outdated. */
		currentHash?: string;
	} = $props();

	const build = $derived(await buildState(buildId));

	const TEXT: Record<BuildStatus, string> = {
		queued: 'Waiting in the queue…',
		running: 'Compiling…',
		success: 'Firmware ready',
		failed: 'Build failed',
		cancelled: 'Build cancelled'
	};
	const outdated = $derived(
		build.status === 'success' && !!currentHash && build.projectHash !== currentHash
	);
	const tone = $derived(
		outdated ? 'warn' : build.status === 'failed' ? 'err' : build.status === 'success' ? 'ok' : ''
	);
</script>

<span class={tone}>{outdated ? 'Build outdated' : TEXT[build.status]}</span>
