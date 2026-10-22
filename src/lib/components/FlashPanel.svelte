<!--
	Flash one device of a finished build: over USB (Web Serial, always), or a way a feature of its
	firmware registered (`flashMethods`, e.g. OTA). The serial monitor is separate
	(`SerialMonitor.svelte`): it would hold the port the flasher needs.
-->
<script lang="ts">
	import { buildState } from '#lib/api/builds.remote.ts';
	import { setDeviceAddress } from '#lib/api/projects.remote.ts';
	import { boards } from '#lib/device/registry.ts';
	import { featureServices } from '#lib/device/generator.ts';
	import { flashMethods } from '#lib/device/features/core/services.ts';
	import { Segmented } from '#lib/device/device-ui/ui/index.ts';
	import Flasher from './Flasher.svelte';

	let {
		buildId,
		chipId,
		deviceAddress
	}: {
		buildId: string;
		chipId: string;
		/** Last known address of the device's web interface (pre-fills OTA). */
		deviceAddress?: string | null;
	} = $props();

	const build = $derived(await buildState(buildId));
	const chip = $derived(build.chips.find((c) => c.id === chipId));
	const role = $derived(build.roles[chipId]);
	/** The flash methods the features of the chip's firmware registered, besides USB. */
	const extra = $derived(chip ? featureServices(chip.features).get(flashMethods).items() : []);

	/** The way picked (a method id; USB if unset). */
	let picked = $state('usb');
	const way = $derived(extra.some((m) => m.id === picked) ? picked : 'usb');

	/** The device was reached at an address: remember it on the saved device. */
	function onAddress(url: string) {
		if (build.projectId) {
			setDeviceAddress({ id: build.projectId, address: url }).catch(() => {});
		}
	}

	function usbHint(boardId: string) {
		const board = boards.find(boardId);
		if (!board || board.usb === 'both') return '';
		return 'Not detected? Hold BOOT while plugging it in.';
	}
</script>

{#if chip && role?.artifacts}
	<div class="grid grid-cols-[minmax(0,1fr)] gap-3 border-t pt-3">
		{#if extra.length}
			<div class="flex">
				<Segmented
					label="Flash {chip.name} via"
					options={[['usb', 'USB'], ...extra.map((m) => [m.id, m.title] as const)]}
					bind:value={() => way, (v) => (picked = v)}
				/>
			</div>
		{/if}
		<!-- All stay mounted, so switching doesn't interrupt one that is running. -->
		<div hidden={way !== 'usb'}>
			<Flasher
				buildId={build.id}
				roleId={chip.id}
				roleName={chip.name}
				boardName={boards.find(role.board)?.name ?? role.board}
				artifacts={role.artifacts}
				hint={usbHint(role.board)}
			/>
		</div>
		{#each extra as { id, component: Method } (id)}
			<div hidden={way !== id}>
				<Method
					buildId={build.id}
					roleId={chip.id}
					artifacts={role.artifacts}
					address={deviceAddress}
					onaddress={onAddress}
				/>
			</div>
		{/each}
	</div>
{/if}
