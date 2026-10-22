<!--
	Scan a Matter QR code ("MT:…"). Live from the camera where the browser allows it (https or
	localhost). The device itself serves plain http://, where browsers block camera access – then
	a photo is taken with the phone's camera app instead.
-->
<script lang="ts">
	import ScanQrCode from '@lucide/svelte/icons/scan-qr-code';
	import { errorMessage } from '../../web-ui/device-ui/api';
	import { canScanLive, matterPayload, qrDecoder } from '../../../device-ui/qr';
	import QrScanner from '../../../device-ui/QrScanner.svelte';
	import { Button } from '../../../device-ui/ui';

	let { onscan }: { onscan: (payload: string) => void } = $props();

	const live = canScanLive();

	let input = $state<HTMLInputElement>();
	let scanning = $state(false);
	let busy = $state(false);
	let error = $state('');

	async function picked() {
		const file = input?.files?.[0];
		if (!file) return;
		busy = true;
		error = '';
		try {
			const found = await (await qrDecoder(1600))(await createImageBitmap(file));
			const payload = matterPayload(found);
			if (payload) onscan(payload);
			else
				error = found.length
					? 'That QR code isn’t a Matter setup code (it should start with “MT:”).'
					: 'No QR code found – take the photo closer and in focus.';
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
			if (input) input.value = '';
		}
	}
</script>

{#if live}
	<Button title="Scan QR code" onclick={() => (scanning = true)}
		><ScanQrCode size={16} /> Scan</Button
	>
	{#if scanning}
		<QrScanner
			onscan={(payload) => {
				scanning = false;
				onscan(payload);
			}}
			onclose={() => (scanning = false)}
		/>
	{/if}
{:else}
	<input
		bind:this={input}
		type="file"
		accept="image/*"
		capture="environment"
		hidden
		onchange={picked}
	/>
	<Button disabled={busy} title="Take a picture of the QR code" onclick={() => input?.click()}>
		<ScanQrCode size={16} />
		{busy ? 'Reading…' : 'Scan'}
	</Button>
{/if}
{#if error}<p class="m-0 basis-full text-sm text-err">{error}</p>{/if}
