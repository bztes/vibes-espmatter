<!-- The General tab of a firmware: Matter product, duplicate and delete. -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { FirmwareConfig } from '#lib/core/model.ts';
	import { KINDS } from '#lib/core/kinds.ts';
	import {
		deleteFirmware,
		duplicateFirmware,
		type getFirmware
	} from '#lib/remote/firmware.remote.ts';
	import { Card, Field, Input, Notice } from '#lib/ui/index.ts';
	import ManageAction from './ManageAction.svelte';

	let {
		config,
		firmware
	}: { config: FirmwareConfig; firmware: Awaited<ReturnType<typeof getFirmware>> } = $props();

	let error = $state('');
	const hex = (n: number) => '0x' + n.toString(16).toUpperCase().padStart(4, '0');

	async function run(fn: () => Promise<unknown>) {
		error = '';
		try {
			await fn();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
</script>

<div class="grid gap-6 lg:grid-cols-2">
	{#if error}<div class="lg:col-span-2"><Notice tone="err">{error}</Notice></div>{/if}
	{#if KINDS[config.kind].matterDevice}
		<Card title="Matter product">
			<div class="grid gap-4">
				<div class="grid grid-cols-2 gap-4">
					<Field
						label="Vendor ID"
						id="vid"
						help="{hex(config.matter.vendorId)} – 0xFFF1–4 are test vendors"
					>
						<Input
							id="vid"
							type="number"
							min="1"
							max="65524"
							mono
							bind:value={config.matter.vendorId}
						/>
					</Field>
					<Field label="Product ID" id="pid" help={hex(config.matter.productId)}>
						<Input
							id="pid"
							type="number"
							min="1"
							max="65535"
							mono
							bind:value={config.matter.productId}
						/>
					</Field>
				</div>
				<p class="m-0 text-xs text-muted">
					Part of the firmware. Pairing codes are per device – on each device’s page.
				</p>
			</div>
		</Card>
	{/if}

	<Card title="Manage" tone="err">
		<div class="divide-y divide-border">
			<ManageAction
				title="Duplicate firmware"
				description="A copy of its peripherals, features and settings to change without touching this one. Builds and devices stay here."
				label="Duplicate"
				onaction={() =>
					run(async () => {
						const { id } = await duplicateFirmware(firmware.id);
						await goto(resolve('/(app)/firmware/[id]', { id }));
					})}
			/>
			<ManageAction
				title="Delete firmware"
				description="Removes it with all its builds."
				label="Delete firmware…"
				variant="danger"
				blocked={firmware.devices.length
					? `${firmware.devices.length} device${firmware.devices.length > 1 ? 's run' : ' runs'} it – delete them or switch them to another firmware first.`
					: undefined}
				confirm="Delete “{config.name}” with all its builds? This can’t be undone."
				onaction={() =>
					run(async () => {
						await deleteFirmware(firmware.id);
						await goto(resolve('/(app)/firmware'));
					})}
			/>
		</div>
	</Card>
</div>
