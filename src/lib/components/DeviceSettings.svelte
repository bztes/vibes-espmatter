<!-- The General tab of a device: its location – and deleting it. -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { deleteDevice, type getDevice } from '#lib/remote/devices.remote.ts';
	import { listLocations, moveDevice } from '#lib/remote/locations.remote.ts';
	import { Card, Field, Notice, Select } from '#lib/ui/index.ts';
	import ManageAction from './ManageAction.svelte';

	let {
		device
	}: {
		device: Awaited<ReturnType<typeof getDevice>>;
	} = $props();

	const locations = $derived(await listLocations());

	let error = $state('');

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

	{#if locations.length}
		<Card title="Location">
			<Field
				label="Location"
				id="location"
				help={device.kind === 'hub'
					? 'Devices of other locations stop using it for updates.'
					: 'Moving it drops a hub of another location. Its Wi-Fi comes from the location unless set here.'}
			>
				<Select
					id="location"
					value={device.location?.id ?? ''}
					onchange={(e) =>
						run(() => moveDevice({ id: device.id, locationId: e.currentTarget.value || null }))}
				>
					{#each locations as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
					<option value="">No location</option>
				</Select>
			</Field>
		</Card>
	{/if}

	<Card title="Manage" tone="err">
		<div class="divide-y divide-border">
			<ManageAction
				title="Delete device"
				description="Removes it from this app, with its own values and API token. Its firmware stays."
				label="Delete device…"
				variant="danger"
				confirm="Delete “{device.name}”? This can’t be undone."
				onaction={() =>
					run(async () => {
						await deleteDevice(device.id);
						await goto(resolve('/(app)'));
					})}
			/>
		</div>
	</Card>
</div>
