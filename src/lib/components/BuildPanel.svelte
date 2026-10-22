<!-- A whole build on one page: progress, log and flashing per device, then the serial monitor once it succeeded. -->
<script lang="ts">
	import { buildState } from '#lib/api/builds.remote.ts';
	import { setDeviceAddress } from '#lib/api/projects.remote.ts';
	import { Panel } from '#lib/device/device-ui/ui/index.ts';
	import BuildProgress from './BuildProgress.svelte';
	import FlashPanel from './FlashPanel.svelte';
	import SerialMonitor from './SerialMonitor.svelte';

	let {
		buildId,
		deviceAddress
	}: {
		buildId: string;
		/** Last known address of the device's web interface (pre-fills OTA). */
		deviceAddress?: string | null;
	} = $props();

	const build = $derived(await buildState(buildId));

	/** The device reported its address over serial: remember it on the saved device. */
	function onAddress(url: string) {
		if (build.projectId) {
			setDeviceAddress({ id: build.projectId, address: url }).catch(() => {});
		}
	}
</script>

<BuildProgress {buildId}>
	{#snippet flash(chipId)}
		<FlashPanel {buildId} {chipId} {deviceAddress} />
	{/snippet}
	{#snippet done()}
		<Panel title="Serial monitor">
			<SerialMonitor onaddress={onAddress} />
		</Panel>
	{/snippet}
</BuildProgress>
