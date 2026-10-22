<script lang="ts">
	import { resolve } from '$app/paths';
	import type { RoleArtifacts } from '#lib/build-types.ts';
	import { errorMessage } from '#lib/errors.ts';
	import { Button, Checkbox, Log, Progress } from '#lib/device/device-ui/ui/index.ts';
	import type { ESPLoader, Transport } from 'esptool-js';

	let {
		buildId,
		roleId,
		roleName,
		boardName,
		artifacts,
		hint,
		onflashed
	}: {
		buildId: string;
		roleId: string;
		roleName: string;
		boardName: string;
		artifacts: RoleArtifacts;
		hint?: string;
		onflashed?: () => void;
	} = $props();

	type Status = 'idle' | 'connecting' | 'flashing' | 'done' | 'error';
	let status = $state<Status>('idle');
	let progress = $state(0);
	let message = $state('');
	let eraseAll = $state(false);
	let lines = $state<string[]>([]);

	const supported = typeof navigator !== 'undefined' && 'serial' in navigator;
	const busy = $derived(status === 'connecting' || status === 'flashing');
	const total = $derived(artifacts.parts.reduce((n, p) => n + p.size, 0));

	function log(line: string) {
		lines = [...lines.slice(-200), line];
	}

	/** Catches firmware built for another module variant (e.g. N8R2 vs N16R8), which boot-loops. */
	async function variantMismatch(loader: ESPLoader): Promise<string | undefined> {
		const detectedFlash = await loader.detectFlashSize();
		if (detectedFlash && parseInt(detectedFlash) < parseInt(artifacts.flashSize)) {
			return `This board has ${detectedFlash} flash, but the ${roleName} firmware was built for ${artifacts.flashSize}. Set "Flash size" under Chip & memory to ${detectedFlash.replace('MB', ' MB')} and rebuild.`;
		}
		// Only the S3 eFuse reliably says which PSRAM is in the package (R2 = quad, R8 = octal).
		const chip = loader.chip as { getPsramCap?: (l: ESPLoader) => Promise<number> };
		if (
			artifacts.chip === 'esp32s3' &&
			artifacts.psram &&
			artifacts.psram !== 'none' &&
			chip.getPsramCap
		) {
			const embedded = ({ 1: 'octal', 2: 'quad' } as Record<number, string>)[
				await chip.getPsramCap(loader)
			];
			if (embedded && embedded !== artifacts.psram) {
				return `This board has ${embedded} PSRAM, but the ${roleName} firmware was built for ${artifacts.psram} PSRAM and would crash at boot. Set "PSRAM" under Chip & memory to ${embedded === 'octal' ? 'Octal (R8, 8 MB)' : 'Quad (R2, 2 MB)'} and rebuild.`;
			}
		}
	}

	/**
	 * Restart the chip into the new firmware. esptool-js' `after('hard_reset')` only releases EN
	 * (RTS low) without pulling it first, so the chip kept running the flasher stub until someone
	 * pressed RESET. Works for USB-UART bridges and the native USB-Serial/JTAG port alike.
	 */
	async function resetIntoApp(transport: Transport) {
		const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
		await transport.setDTR(false); // IO0 high: boot the app, not the ROM bootloader
		await transport.setRTS(true); // EN low: hold in reset
		await sleep(200);
		await transport.setRTS(false); // release: the new firmware starts
		await sleep(200);
	}

	async function flash() {
		status = 'connecting';
		progress = 0;
		message = 'Select the serial port of the board…';
		lines = [];
		const { ESPLoader, Transport } = await import('esptool-js');
		let port: SerialPort;
		try {
			port = await navigator.serial.requestPort();
		} catch {
			status = 'idle';
			message = '';
			return;
		}
		const transport = new Transport(port, false);
		try {
			const loader = new ESPLoader({
				transport,
				baudrate: 460800,
				terminal: {
					clean: () => {},
					writeLine: (data: string) => log(data),
					write: (data: string) => log(data)
				}
			});
			message = 'Connecting – hold BOOT and tap RESET if this takes long…';
			const description = await loader.main();
			const detected = loader.chip.CHIP_NAME.toLowerCase().replace(/-/g, '');
			if (detected !== artifacts.chip) {
				throw new Error(
					`This is an ${loader.chip.CHIP_NAME}, but the ${roleName} firmware is for ${artifacts.chip}. Did you connect the right board?`
				);
			}
			const mismatch = await variantMismatch(loader);
			if (mismatch) throw new Error(mismatch);
			message = `Connected to ${description}. Downloading firmware…`;

			const files = await Promise.all(
				artifacts.parts.map(async (part) => {
					const res = await fetch(
						resolve('/api/builds/[id]/[...file]', { id: buildId, file: `${roleId}/${part.file}` })
					);
					if (!res.ok) throw new Error(`Failed to download ${part.file}`);
					return { address: part.offset, data: new Uint8Array(await res.arrayBuffer()) };
				})
			);

			status = 'flashing';
			message = eraseAll ? 'Erasing flash and writing firmware…' : 'Writing firmware…';
			await loader.writeFlash({
				fileArray: files,
				flashMode: 'keep',
				flashFreq: 'keep',
				flashSize: 'keep',
				eraseAll,
				compress: true,
				reportProgress: (index, written) => {
					const before = files.slice(0, index).reduce((n, f) => n + f.data.length, 0);
					progress = Math.min(1, (before + written) / total);
				}
			});
			await resetIntoApp(transport);
			progress = 1;
			status = 'done';
			message = `${roleName} flashed successfully. The board restarts now.`;
			onflashed?.();
		} catch (err) {
			status = 'error';
			message = errorMessage(err);
		} finally {
			await transport.disconnect().catch(() => {});
		}
	}
</script>

<div class="grid gap-2.5">
	{#if !supported}
		<p class="m-0 text-warn">
			Needs Web Serial (Chrome, Edge or Opera on desktop) – or use esptool.py.
		</p>
	{:else}
		{#if hint}<p class="m-0 text-xs text-muted">{hint}</p>{/if}
		<div class="flex flex-wrap items-center gap-2">
			<Button variant="primary" onclick={flash} disabled={busy}>
				{busy ? 'Flashing…' : 'Flash via USB'}
			</Button>
			<Checkbox bind:checked={eraseAll} disabled={busy} title="Resets Wi-Fi, Thread and Matter data"
				>Erase flash first</Checkbox
			>
		</div>
		{#if status !== 'idle'}
			<Progress value={progress} error={status === 'error'} />
			<p class="m-0 text-sm" class:text-err={status === 'error'} class:text-ok={status === 'done'}>
				{message}
				{#if status === 'flashing'}<span class="text-muted">{Math.round(progress * 100)} %</span
					>{/if}
			</p>
		{/if}
		{#if lines.length}
			<details class="text-xs">
				<summary class="mb-1.5 cursor-pointer text-muted">esptool output</summary>
				<Log {lines} height={192} />
			</details>
		{/if}
	{/if}
	<p class="m-0 text-xs text-muted">
		{boardName} ·
		<a
			href="{resolve('/api/builds/[id]/[...file]', {
				id: buildId,
				file: `${roleId}/${artifacts.merged}`
			})}?download"
			data-sveltekit-reload>full image (0x0)</a
		>
	</p>
</div>
