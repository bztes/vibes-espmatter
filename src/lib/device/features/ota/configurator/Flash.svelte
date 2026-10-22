<!-- Flash a finished build over the network: the device's `POST /api/ota` (needs this feature on it already). -->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { FlashProps } from '#lib/device/configurator.ts';
	import { resolve } from '$app/paths';
	import { Button, Input } from '#lib/device/device-ui/ui/index.ts';
	import { toDeviceUrl } from '#lib/device-address.ts';
	import { errorMessage } from '#lib/errors.ts';

	let { buildId, roleId, artifacts, address: knownAddress, onaddress }: FlashProps = $props();

	const app = $derived(artifacts.app);

	const known = $derived(knownAddress?.replace(/^http:\/\//, '') ?? '');
	let address = $state('');
	let prefilled = '';
	// Follow the known address (it changes when the device reports a new one) unless edited.
	$effect.pre(() => {
		const next = known;
		untrack(() => {
			if (!address || address === prefilled) address = next;
		});
		prefilled = next;
	});
	let username = $state('admin');
	let password = $state('');
	let status = $state<'idle' | 'busy' | 'done' | 'error'>('idle');
	let message = $state('');

	async function push(event: SubmitEvent) {
		event.preventDefault();
		status = 'busy';
		message = 'Downloading firmware…';
		try {
			const res = await fetch(
				resolve('/api/builds/[id]/[...file]', { id: buildId, file: `${roleId}/${app}` })
			);
			if (!res.ok) throw new Error('Could not download the firmware image');
			const image = await res.blob();
			const base = toDeviceUrl(address);
			message = `Uploading ${Math.round(image.size / 1024)} KB to ${base}…`;
			const headers: Record<string, string> = {};
			if (password) headers.authorization = `Basic ${btoa(`${username}:${password}`)}`;
			// Untyped blob → no content-type header → no CORS preflight unless we authenticate.
			const upload = await fetch(new URL('/api/ota', base), {
				method: 'POST',
				body: new Blob([image]),
				headers
			});
			const data = await upload.json().catch(() => ({}));
			if (!upload.ok) throw new Error(data.error ?? `Device answered ${upload.status}`);
			status = 'done';
			message = 'Update installed – the device restarts.';
			onaddress?.(base);
		} catch (err) {
			status = 'error';
			message =
				err instanceof TypeError
					? 'Device not reachable – check the address (https:// pages can’t reach http:// devices).'
					: errorMessage(err);
		}
	}
</script>

<div>
	<form
		class="grid grid-cols-2 items-end gap-x-3 [&>label:first-child]:col-span-full"
		onsubmit={push}
	>
		<Input label="Device address" placeholder="192.168.1.50" bind:value={address} required />
		<Input label="Admin user" bind:value={username} />
		<Input
			label="Password"
			type="password"
			placeholder="the device’s"
			title="An admin account of the device (its current password)"
			bind:value={password}
		/>
		<Button type="submit" variant="primary" class="justify-self-start" disabled={status === 'busy'}
			>Update over the air</Button
		>
	</form>
	{#if message}
		<p class="mt-2 text-sm" class:text-err={status === 'error'} class:text-ok={status === 'done'}>
			{message}
		</p>
	{/if}
	<p class="mt-1 mb-0 text-xs text-muted">
		The device must already run firmware with “Over-the-air updates” ·
		<a
			href="{resolve('/api/builds/[id]/[...file]', {
				id: buildId,
				file: `${roleId}/${app}`
			})}?download"
			data-sveltekit-reload>app image</a
		>
	</p>
</div>
