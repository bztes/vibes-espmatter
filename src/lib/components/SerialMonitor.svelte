<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Alert, Button, Log } from '#lib/device/device-ui/ui/index.ts';
	import { errorMessage } from '#lib/errors.ts';

	/** Called when the device reports the address of its web interface. */
	let { onaddress }: { onaddress?: (url: string) => void } = $props();

	let lines = $state<string[]>([]);
	let connected = $state(false);
	let error = $state('');
	let webUrl: string | null = null;

	let port: SerialPort | undefined;
	let reader: ReadableStreamDefaultReader<string> | undefined;
	let closed: Promise<void> | undefined;

	const supported = typeof navigator !== 'undefined' && 'serial' in navigator;
	// Strip ANSI color codes from ESP-IDF logs.
	const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

	async function connect() {
		error = '';
		try {
			port = await navigator.serial.requestPort();
			await port.open({ baudRate: 115200 });
			// Release reset (DTR/RTS) in case the board was held in reset by a previous session.
			await port.setSignals({ dataTerminalReady: false, requestToSend: false }).catch(() => {});
		} catch (err) {
			error = errorMessage(err);
			return;
		}
		connected = true;
		const decoder = new TextDecoderStream();
		closed = port.readable!.pipeTo(decoder.writable as WritableStream<Uint8Array>).catch(() => {});
		reader = decoder.readable.getReader();
		let buffer = '';
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += value;
				const parts = buffer.split(/\r?\n/);
				buffer = parts.pop() ?? '';
				if (parts.length) push(parts.map((l) => l.replace(ANSI, '')));
			}
		} catch (err) {
			error = errorMessage(err);
		} finally {
			await disconnect();
		}
	}

	function push(newLines: string[]) {
		for (const line of newLines) {
			const match = line.match(/MESP_WEB_URL=(http:\/\/\S+)/);
			if (match && match[1] !== webUrl) {
				webUrl = match[1];
				onaddress?.(match[1]);
			}
		}
		lines = [...lines, ...newLines].slice(-500);
	}

	async function disconnect() {
		connected = false;
		await reader?.cancel().catch(() => {});
		await closed;
		await port?.close().catch(() => {});
		reader = undefined;
		port = undefined;
	}

	async function reset() {
		if (!port) return;
		await port.setSignals({ dataTerminalReady: false, requestToSend: true });
		await new Promise((r) => setTimeout(r, 100));
		await port.setSignals({ dataTerminalReady: false, requestToSend: false });
	}

	onDestroy(() => void disconnect());
</script>

{#if supported}
	<div class="grid gap-2">
		<div class="flex flex-wrap items-center gap-2">
			{#if connected}
				<Button onclick={disconnect}>Disconnect</Button>
				<Button onclick={reset} title="Toggles RTS (USB-UART bridges)">Reset board</Button>
			{:else}
				<Button onclick={connect}>Open serial monitor</Button>
			{/if}
			<Button onclick={() => (lines = [])} disabled={!lines.length}>Clear</Button>
		</div>
		{#if error}<Alert>{error}</Alert>{/if}
		{#if lines.length || connected}<Log {lines} height={288} />{/if}
	</div>
{/if}
