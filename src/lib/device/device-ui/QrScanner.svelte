<!--
	Full-screen live QR scanner (rear camera, continuous autofocus, torch if available). Decodes a
	few frames per second and closes on the first Matter setup code. Needs a secure context – see
	`canScanLive()`. Used by the device web interface and the vibes-espmatter app; self-contained styles.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Flashlight from '@lucide/svelte/icons/flashlight';
	import X from '@lucide/svelte/icons/x';
	import { matterPayload, qrDecoder } from './qr';

	let { onscan, onclose }: { onscan: (payload: string) => void; onclose: () => void } = $props();

	const SCAN_INTERVAL_MS = 150;
	const roundButton =
		'grid size-[46px] cursor-pointer place-items-center rounded-full border-0 p-0';

	let video = $state<HTMLVideoElement>();
	let status = $state('Starting camera…');
	let error = $state('');
	let torch = $state<boolean | undefined>(); // undefined = not supported
	let track: MediaStreamTrack | undefined;

	async function setTorch(on: boolean) {
		try {
			await track?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
			torch = on;
		} catch {
			torch = undefined;
		}
	}

	onMount(() => {
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let stream: MediaStream | undefined;

		(async () => {
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					audio: false,
					video: {
						facingMode: { ideal: 'environment' },
						width: { ideal: 1920 },
						height: { ideal: 1080 }
					}
				});
				if (stopped) return stream.getTracks().forEach((t) => t.stop());
				track = stream.getVideoTracks()[0];
				// Not in the TS lib yet; Android Chrome honours it, others ignore it.
				const caps = (track.getCapabilities?.() ?? {}) as { focusMode?: string[]; torch?: boolean };
				if (caps.focusMode?.includes('continuous')) {
					await track
						.applyConstraints({
							advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet]
						})
						.catch(() => {});
				}
				if (caps.torch) torch = false;
				video!.srcObject = stream;
				await video!.play();
				status = 'Point the camera at the QR code';
				const decode = await qrDecoder();
				const tick = async () => {
					if (stopped) return;
					const payload = video && matterPayload(await decode(video).catch(() => []));
					if (payload) {
						navigator.vibrate?.(60);
						onscan(payload);
						return;
					}
					timer = setTimeout(tick, SCAN_INTERVAL_MS);
				};
				tick();
			} catch (e) {
				const name = (e as { name?: string }).name;
				error =
					name === 'NotAllowedError'
						? 'Camera access was denied. Allow it in the browser’s site settings.'
						: name === 'NotFoundError'
							? 'No camera found.'
							: e instanceof Error
								? e.message
								: String(e);
			}
		})();

		return () => {
			stopped = true;
			clearTimeout(timer);
			stream?.getTracks().forEach((t) => t.stop());
		};
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div
	class="fixed inset-0 z-1000 bg-black text-[15px]/[1.4] text-white"
	role="dialog"
	aria-modal="true"
	aria-label="Scan QR code"
>
	<video bind:this={video} class="size-full object-cover" playsinline muted></video>
	<div
		class="absolute top-1/2 left-1/2 aspect-square w-[min(70vw,70vh,320px)] -translate-1/2 rounded-[18px] border-3 border-white/90 shadow-[0_0_0_100vmax_rgb(0_0_0/0.45)]"
		aria-hidden="true"
	></div>
	<p
		class="absolute right-4 bottom-[max(32px,env(safe-area-inset-bottom))] left-4 m-0 text-center [text-shadow:0_1px_3px_#000]"
	>
		{error || status}
	</p>
	<div class="absolute top-[max(16px,env(safe-area-inset-top))] right-4 flex gap-2.5">
		{#if torch !== undefined}
			<button
				type="button"
				class={[roundButton, torch ? 'bg-[#facc15] text-black' : 'bg-black/55 text-white']}
				aria-label="Torch"
				aria-pressed={torch}
				onclick={() => setTorch(!torch)}><Flashlight size={22} /></button
			>
		{/if}
		<button
			type="button"
			class={[roundButton, 'bg-black/55 text-white']}
			aria-label="Close"
			onclick={onclose}><X size={22} /></button
		>
	</div>
</div>
