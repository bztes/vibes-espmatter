<!-- Flash a slot's images – and the device's settings – over Web Serial with esptool-js (Chrome/Edge). A board keeps the settings it has. -->
<script lang="ts">
	import Usb from '@lucide/svelte/icons/usb';
	import { resolve } from '$app/paths';
	import type { DeviceSettings } from '#lib/core/model.ts';
	import type { SlotArtifacts } from '#lib/types.ts';
	import { CFG_PARTITION } from '#lib/core/cfg.ts';
	import { deploy, reportUsb } from '#lib/remote/deploy.remote.ts';
	import { usbFlashImage } from '#lib/remote/devices.remote.ts';
	import { Button, Checkbox, Code, CodeBlock, Notice } from '#lib/ui/index.ts';
	import {
		connectBoard,
		findPartition,
		fromBase64,
		resetBoard,
		serialSupported,
		toBase64
	} from './serial.ts';

	let {
		buildId,
		slot,
		artifacts,
		deviceId,
		draft
	}: {
		buildId: string;
		slot: string;
		artifacts: SlotArtifacts;
		deviceId: string;
		/** For a board without settings of this device: written with the firmware. */
		draft?: { settings: DeviceSettings; password: string };
	} = $props();

	type Status = 'idle' | 'connecting' | 'flashing' | 'done' | 'error';
	let status = $state<Status>('idle');
	let progress = $state(0);
	let message = $state('');
	let eraseAll = $state(false);
	let log = $state<string[]>([]);

	const supported = serialSupported();
	const busy = $derived(status === 'connecting' || status === 'flashing');
	const total = $derived(
		artifacts.parts.reduce((n, p) => n + p.size, 0) + (artifacts.config?.size ?? 0)
	);

	async function flash() {
		log = [];
		message = 'Connecting – if it hangs, hold BOOT and tap RESET.';
		status = 'connecting';
		progress = 0;
		let board;
		try {
			board = await connectBoard((l) => (log = [...log.slice(-150), l]));
		} catch (err) {
			status = 'error';
			message = err instanceof Error ? err.message : String(err);
			return;
		}
		if (!board) return void (status = 'idle'); // dialog closed
		const { loader, transport, description } = board;
		let deploymentId: string | undefined;
		try {
			const detected = loader.chip.CHIP_NAME.toLowerCase().replace(/-/g, '');
			if (detected !== artifacts.chip)
				throw new Error(
					`This is an ${loader.chip.CHIP_NAME}, but the ${artifacts.name} firmware is for ${artifacts.chip}. Is the right board connected?`
				);
			const flashSize = await loader.detectFlashSize();
			if (flashSize && parseInt(flashSize) < parseInt(artifacts.flashSize))
				throw new Error(
					`The board has ${flashSize} flash, the firmware needs ${artifacts.flashSize}. Pick the right board variant and rebuild.`
				);
			({ id: deploymentId } = await deploy({ buildId, deviceId, slot, method: 'usb' }));
			message = `Connected to ${description}. Downloading firmware…`;
			const files = await Promise.all(
				artifacts.parts.map(async (part) => {
					const res = await fetch(
						resolve('/api/v1/firmware/[build]/[slot]/[file]', {
							build: buildId,
							slot,
							file: part.file
						})
					);
					if (!res.ok) throw new Error(`Download of ${part.file} failed (${res.status})`);
					return { address: part.offset, data: new Uint8Array(await res.arrayBuffer()) };
				})
			);
			// The device's own settings: what the board has (kept), else the ones entered here.
			let kept = false;
			if (artifacts.config) {
				message = 'Reading the board’s settings…';
				// Where the board has them now: the new build may lay out its partitions differently.
				const where = (await findPartition(loader, CFG_PARTITION)) ?? artifacts.config;
				const current =
					where.size === artifacts.config.size
						? await loader.readFlash(where.offset, where.size)
						: undefined;
				const { image, kept: k } = await usbFlashImage({
					id: deviceId,
					current: current && toBase64(current),
					draft: draft?.settings,
					password: draft?.password || undefined
				});
				kept = k;
				files.push({ address: artifacts.config.offset, data: fromBase64(image) });
			}
			status = 'flashing';
			message = eraseAll ? 'Erasing and writing…' : 'Writing…';
			await loader.writeFlash({
				fileArray: files,
				flashMode: 'keep',
				flashFreq: 'keep',
				flashSize: 'keep',
				eraseAll,
				compress: true,
				reportProgress: (index: number, written: number) => {
					const before = files.slice(0, index).reduce((n, f) => n + f.data.length, 0);
					progress = Math.min(1, (before + written) / total);
				}
			});
			await resetBoard(transport);
			progress = 1;
			status = 'done';
			message = `${artifacts.name} flashed${
				artifacts.config ? (kept ? ', it keeps its settings' : ', with the settings from here') : ''
			}. The board restarts now.`;
			await reportUsb({ id: deploymentId, ok: true, message: 'Flashed over USB.' });
		} catch (err) {
			status = 'error';
			message = err instanceof Error ? err.message : String(err);
			if (deploymentId)
				await reportUsb({ id: deploymentId, ok: false, message: message.slice(0, 300) }).catch(
					() => {}
				);
		} finally {
			await transport.disconnect().catch(() => {});
		}
	}
</script>

{#if !supported}
	<Notice tone="warn"
		>USB flashing needs Web Serial (Chrome, Edge or Opera on desktop). Or download the image and use <Code
			>esptool.py write_flash 0x0 merged.bin</Code
		>.</Notice
	>
{:else}
	<div class="grid gap-3">
		<div class="flex flex-wrap items-center gap-3">
			<Button variant="primary" onclick={flash} disabled={busy}
				><Usb size={16} />{busy ? 'Flashing…' : `Flash ${artifacts.name}`}</Button
			>
			<Checkbox
				class="gap-1.5 text-muted"
				title="Also resets Wi-Fi, Thread and Matter pairings"
				label="Erase flash first"
				bind:checked={eraseAll}
				disabled={busy}
			/>
		</div>
		{#if status !== 'idle'}
			<div class="h-2 overflow-hidden rounded-full bg-surface-2">
				<div
					class={[
						'h-full rounded-full transition-[width]',
						status === 'error' ? 'bg-err' : status === 'done' ? 'bg-ok' : 'bg-accent'
					]}
					style:width="{Math.round(progress * 100)}%"
				></div>
			</div>
			<p
				class={[
					'm-0 text-sm',
					status === 'error' ? 'text-err' : status === 'done' ? 'text-ok' : 'text-muted'
				]}
			>
				{message}{#if status === 'flashing'}
					{Math.round(progress * 100)} %{/if}
			</p>
		{/if}
		{#if log.length}
			<details class="text-xs">
				<summary class="cursor-pointer text-muted">esptool output</summary>
				<CodeBlock class="mt-2 max-h-48 p-2">{log.join('\n')}</CodeBlock>
			</details>
		{/if}
	</div>
{/if}
