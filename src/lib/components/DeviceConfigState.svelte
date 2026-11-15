<!-- The Device settings tab's bar: where the settings come from (the board, or entered before its first flash), reading and writing them over the air or over USB. -->
<script lang="ts" module>
	/** `board`: read over the air; `usb`: read over USB; `unread`: connected, not asked yet. */
	export type BoardState = 'unread' | 'loading' | 'board' | 'usb' | 'draft' | 'offline' | 'error';
	export type Via = 'air' | 'usb';
</script>

<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Upload from '@lucide/svelte/icons/upload';
	import Usb from '@lucide/svelte/icons/usb';
	import Wifi from '@lucide/svelte/icons/wifi';
	import { serialSupported } from './firmware/serial.ts';
	import { Badge, Button, Notice, relativeTime } from '#lib/ui/index.ts';

	let {
		state: boardState,
		readAt,
		error,
		sent,
		dirty,
		busy,
		blocked,
		connected,
		usbStep,
		onread,
		onwrite,
		ondiscard
	}: {
		state: BoardState;
		/** When the settings were read from the board. */
		readAt?: Date;
		error?: string;
		/** What happened after the last write. */
		sent?: string;
		dirty: boolean;
		busy: boolean;
		/** The settings have errors: they can't be written. */
		blocked?: string;
		connected: boolean;
		/** What happens over USB right now. */
		usbStep: string;
		onread: (via: Via) => void;
		onwrite: (via: Via) => void;
		ondiscard: () => void;
	} = $props();

	const usb = serialSupported();
	const read = $derived(boardState === 'board' || boardState === 'usb');
	/** The way they were read is the suggested way back. */
	const from = $derived<Via>(boardState === 'usb' ? 'usb' : 'air');
	const canWrite = $derived(dirty && !busy && !blocked);
</script>

<div class="grid gap-3">
	<div class="flex flex-wrap items-center gap-x-6 gap-y-3">
		<div class="flex min-w-0 flex-1 basis-72 items-center gap-2 text-sm">
			{#if boardState === 'unread'}<Badge>not read</Badge>
				<span class="text-muted">Read them from the device to see and change them.</span>
			{:else if boardState === 'loading'}<Badge tone="info">reading…</Badge>
				<span class="text-muted">Asking the device for its settings.</span>
			{:else if read}
				{#if dirty}<Badge tone="warn">changed</Badge>{:else}<Badge tone="ok">as on the board</Badge
					>{/if}
				<span class="text-muted"
					>Read {boardState === 'usb' ? 'over USB' : 'over the air'}
					{readAt ? relativeTime(readAt) : ''}.{#if dirty}
						Write them back – the device restarts with them.{/if}</span
				>
			{:else if boardState === 'draft'}<Badge tone="info">first flash</Badge>
				<span class="text-muted"
					>Not flashed yet: these go onto the board with its first USB flash (Firmware tab). A board
					that already has settings keeps its own.</span
				>
			{:else if boardState === 'offline'}<Badge tone="warn">offline</Badge>
				<span class="text-muted">The device isn’t connected to the app. Read them over USB.</span>
			{:else}<Badge tone="err">not read</Badge>{/if}
		</div>

		<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
			{#if (connected && boardState !== 'draft') || usb}
				<div class="flex items-center gap-1.5" role="group" aria-label="Read from the board">
					<span class="mr-1 flex items-center gap-1 text-xs font-medium text-muted"
						><Download size={14} />Read</span
					>
					{#if connected && boardState !== 'draft'}<Button
							size="sm"
							disabled={busy || boardState === 'loading'}
							onclick={() => onread('air')}><Wifi size={14} />Over the air</Button
						>{/if}
					{#if usb}<Button
							size="sm"
							disabled={busy}
							title="Connect the board to this computer"
							onclick={() => onread('usb')}><Usb size={14} />USB</Button
						>{/if}
				</div>
			{/if}

			{#if read}
				<div class="flex items-center gap-1.5" role="group" aria-label="Write to the board">
					<span class="mr-1 flex items-center gap-1 text-xs font-medium text-muted"
						><Upload size={14} />Write</span
					>
					{#if connected}<Button
							size="sm"
							variant={from === 'air' ? 'primary' : 'secondary'}
							disabled={!canWrite}
							onclick={() => onwrite('air')}><Wifi size={14} />Over the air</Button
						>{/if}
					{#if usb}<Button
							size="sm"
							variant={from === 'usb' || !connected ? 'primary' : 'secondary'}
							disabled={!canWrite}
							title="Connect the board to this computer"
							onclick={() => onwrite('usb')}><Usb size={14} />USB</Button
						>{/if}
					<Button size="sm" variant="ghost" disabled={!dirty || busy} onclick={ondiscard}
						><Undo2 size={14} />Discard</Button
					>
				</div>
			{/if}
		</div>
	</div>
	{#if error}<Notice tone="err">{error}</Notice>{/if}
	{#if blocked && dirty}<Notice tone="err">{blocked}</Notice>{/if}
	{#if usbStep}<Notice tone="info">{usbStep}</Notice>{/if}
	{#if sent}<Notice tone="ok">{sent}</Notice>{/if}
</div>
