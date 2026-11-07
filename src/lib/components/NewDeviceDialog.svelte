<!-- A new device: of an existing firmware, or with a new one (configured next). -->
<script lang="ts">
	import Router from '@lucide/svelte/icons/router';
	import Cpu from '@lucide/svelte/icons/cpu';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { KINDS } from '#lib/core/kinds.ts';
	import { createDevice } from '#lib/remote/devices.remote.ts';
	import { listFirmwares } from '#lib/remote/firmware.remote.ts';
	import { listLocations } from '#lib/remote/locations.remote.ts';
	import { Button, Dialog, Field, Input, Select } from '#lib/ui/index.ts';

	let {
		kind = $bindable(),
		locationId: initialLocation = null,
		firmwareId: fixedFirmware
	}: {
		kind?: 'hub' | 'device';
		/** Preselected: the location the device list shows. */
		locationId?: string | null;
		/** Add a device to this firmware (no choice). */
		firmwareId?: string;
	} = $props();

	const locations = $derived(await listLocations());
	const firmwares = $derived(await listFirmwares());
	let locationId = $derived(initialLocation);
	const ofKind = $derived(firmwares.filter((f) => f.kind === kind));
	/** `''`: a new firmware. */
	let firmwareId = $derived(fixedFirmware ?? ofKind[0]?.id ?? '');

	let name = $state('');
	let error = $state('');
	let busy = $state(false);
	let open = $derived(!!kind);

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (!kind) return;
		busy = true;
		error = '';
		try {
			const created = await createDevice({
				kind,
				name: name.trim() || KINDS[kind].defaultName,
				firmwareId: firmwareId || null,
				locationId
			});
			kind = undefined;
			name = '';
			// A new firmware needs its boards and peripherals first.
			await goto(
				created.newFirmware
					? resolve('/(app)/firmware/[id]', { id: created.firmwareId })
					: resolve('/(app)/devices/[id]', { id: created.id })
			);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog
	bind:open={() => open, (v) => !v && (kind = undefined)}
	title="New {kind === 'hub' ? 'hub' : 'device'}"
>
	<form id="new-device" class="grid gap-4" onsubmit={create}>
		{#if !fixedFirmware}
			<div class="grid grid-cols-2 gap-3">
				{#each Object.values(KINDS) as k (k.id)}
					<button
						type="button"
						onclick={() => (kind = k.id)}
						class={[
							'grid gap-2 rounded-xl border p-4 text-left transition',
							kind === k.id
								? 'border-accent bg-accent-soft/60 ring-2 ring-accent/20'
								: 'border-border hover:border-border-strong'
						]}
					>
						<span
							class={[
								'grid size-9 place-items-center rounded-lg',
								kind === k.id ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted'
							]}
						>
							{#if k.id === 'hub'}<Router size={18} />{:else}<Cpu size={18} />{/if}
						</span>
						<span class="text-sm font-semibold">{k.name}</span>
						<span class="text-xs text-muted">{k.description}</span>
					</button>
				{/each}
			</div>
			<Field
				label="Firmware"
				id="device-firmware"
				help={firmwareId
					? 'Runs this firmware – with its own name, network and settings.'
					: 'You set up its boards and peripherals next; more devices can run it later.'}
			>
				<Select id="device-firmware" bind:value={firmwareId}>
					{#each ofKind as f (f.id)}<option value={f.id}
							>{f.name} ({f.devices} device{f.devices === 1 ? '' : 's'})</option
						>{/each}
					<option value="">New firmware</option>
				</Select>
			</Field>
		{/if}
		<Field
			label="Name"
			id="device-name"
			help="Shown in apps like Apple Home; also the hostname."
			error={error || undefined}
		>
			<!-- svelte-ignore a11y_autofocus -->
			<Input
				id="device-name"
				maxlength={48}
				placeholder={kind ? KINDS[kind].defaultName : ''}
				bind:value={name}
				autofocus
			/>
		</Field>
		{#if locations.length}
			<Field label="Location" id="device-location">
				<Select id="device-location" bind:value={locationId}>
					{#each locations as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
					<option value={null}>No location</option>
				</Select>
			</Field>
		{/if}
	</form>
	{#snippet footer()}
		<Button onclick={() => (kind = undefined)}>Cancel</Button>
		<Button variant="primary" type="submit" form="new-device" disabled={busy}
			>{busy ? 'Creating…' : 'Create'}</Button
		>
	{/snippet}
</Dialog>
