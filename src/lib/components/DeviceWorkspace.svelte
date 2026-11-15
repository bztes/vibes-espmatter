<!-- A device: what the app keeps for it, its board's settings (read from it, sent back on save; live checks), wiring, its firmware and installing it, its REST API. -->
<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Cable from '@lucide/svelte/icons/cable';
	import Check from '@lucide/svelte/icons/check';
	import Code from '@lucide/svelte/icons/code';
	import Cpu from '@lucide/svelte/icons/cpu';
	import Router from '@lucide/svelte/icons/router';
	import Info from '@lucide/svelte/icons/info';
	import MemoryStick from '@lucide/svelte/icons/memory-stick';
	import Zap from '@lucide/svelte/icons/zap';
	import { untrack } from 'svelte';
	import { resolve as path } from '$app/paths';
	import { assemble } from '#lib/core/assemble.ts';
	import { CFG_PARTITION } from '#lib/core/cfg.ts';
	import { effectiveConfig, normalizeDevice, PASSWORD_SET } from '#lib/core/device.ts';
	import { KINDS } from '#lib/core/kinds.ts';
	import type { DeviceSettings as Settings_ } from '#lib/core/model.ts';
	import { validateDevice } from '#lib/core/validate.ts';
	import {
		readDeviceSettings,
		readUsbSettings,
		saveDevice,
		usbSettingsImage,
		writeDeviceSettings,
		type getDevice
	} from '#lib/remote/devices.remote.ts';
	import { Badge, button, Card, Spinner, Tabs } from '#lib/ui/index.ts';
	import ApiDocs from './ApiDocs.svelte';
	import DeviceBoardSettings from './DeviceBoardSettings.svelte';
	import DeviceConfigState, { type BoardState, type Via } from './DeviceConfigState.svelte';
	import DeviceGeneral from './DeviceGeneral.svelte';
	import InstallPanel from './firmware/InstallPanel.svelte';
	import {
		connectBoard,
		findPartition,
		fromBase64,
		resetBoard,
		toBase64,
		type Board
	} from './firmware/serial.ts';
	import WiringDiagram from './wiring/WiringDiagram.svelte';

	type Device = Awaited<ReturnType<typeof getDevice>>;
	let { device, tab }: { device: Device; tab: string } = $props();

	// The name is the app's (autosaved); the settings are the board's: read from it, sent back on save.
	let name = $state(untrack(() => device.name));
	let lastSaved = untrack(() => name);
	let saving = $state<'saved' | 'dirty' | 'saving' | 'error'>('saved');
	let saveError = $state('');

	// Not read on open: asking costs battery-powered devices a wake-up.
	let board = $state<BoardState>(
		untrack(() => (device.connectedSince ? 'unread' : !device.lastSeenAt ? 'draft' : 'offline'))
	);
	let settings = $state<Settings_ | null>(
		untrack(() => (board === 'draft' ? normalizeDevice({}, device.firmware.config) : null))
	);
	/** A new admin password, sent with the settings (or the first flash). */
	let password = $state('');
	let readAt = $state<Date>();
	let boardError = $state('');
	let sent = $state('');
	let sending = $state(false);
	let loaded = '';
	/** What happens over USB right now. */
	let usbStep = $state('');
	const dirty = $derived(
		(board === 'board' || board === 'usb') &&
			!!settings &&
			(JSON.stringify(settings) !== loaded || !!password)
	);

	function loadedFrom(s: Settings_, from: 'board' | 'usb') {
		settings = s;
		loaded = JSON.stringify(s);
		password = '';
		readAt = new Date();
		board = from;
	}

	function markSent(how: string) {
		if (password && settings) settings.uiPasswordHash = PASSWORD_SET;
		password = '';
		loaded = JSON.stringify(settings);
		sent = how;
	}

	/** Connect over USB, find the settings partition, run `fn`, restart the board. */
	async function overUsb(fn: (b: Board, part: { offset: number; size: number }) => Promise<void>) {
		boardError = '';
		sent = '';
		usbStep = 'Connecting – if it hangs, hold BOOT and tap RESET.';
		let b: Board | undefined;
		try {
			b = await connectBoard(() => {});
			if (!b) return;
			usbStep = 'Reading the board’s settings…';
			const part = await findPartition(b.loader, CFG_PARTITION);
			if (!part) throw new Error('This board has no settings – flash it from the Firmware tab.');
			await fn(b, part);
			await resetBoard(b.transport);
		} catch (e) {
			boardError = e instanceof Error ? e.message : String(e);
		} finally {
			usbStep = '';
			await b?.transport.disconnect().catch(() => {});
		}
	}

	const readUsb = () =>
		overUsb(async ({ loader }, part) => {
			const image = await loader.readFlash(part.offset, part.size);
			loadedFrom(await readUsbSettings({ id: device.id, image: toBase64(image) }), 'usb');
		});

	const writeUsb = () =>
		overUsb(async ({ loader }, part) => {
			if (!settings) return;
			const current = await loader.readFlash(part.offset, part.size);
			const image = await usbSettingsImage({
				id: device.id,
				current: toBase64(current),
				settings: $state.snapshot(settings),
				password: password || undefined
			});
			usbStep = 'Writing…';
			await loader.writeFlash({
				fileArray: [{ address: part.offset, data: fromBase64(image) }],
				flashMode: 'keep',
				flashFreq: 'keep',
				flashSize: 'keep',
				eraseAll: false,
				compress: true
			});
			markSent('Written over USB – the board restarts with them.');
		});

	async function read() {
		board = 'loading';
		boardError = '';
		try {
			loadedFrom(await readDeviceSettings(device.id), 'board');
		} catch (e) {
			boardError = e instanceof Error ? e.message : String(e);
			board = 'error';
		}
	}

	async function writeAir() {
		if (!settings) return;
		sending = true;
		boardError = '';
		sent = '';
		try {
			await writeDeviceSettings({
				id: device.id,
				settings: $state.snapshot(settings),
				password: password || undefined
			});
			markSent('Sent over the air – the device restarts with them.');
		} catch (e) {
			boardError = e instanceof Error ? e.message : String(e);
		} finally {
			sending = false;
		}
	}

	const readVia = (via: Via) => (via === 'usb' ? readUsb() : read());
	const writeVia = (via: Via) => (via === 'usb' ? writeUsb() : writeAir());

	function discard() {
		settings = JSON.parse(loaded);
		password = '';
	}

	const deviceName = $derived(name.trim() || device.name);
	const effective = $derived(
		settings
			? effectiveConfig(device.firmware.config, settings, deviceName)
			: { ...device.firmware.config, name: deviceName }
	);
	const issues = $derived(
		settings
			? validateDevice(
					device.firmware.config,
					// A new password counts as set.
					password ? { ...settings, uiPasswordHash: PASSWORD_SET } : settings,
					deviceName
				)
			: []
	);
	const errors = $derived(issues.filter((i) => i.severity === 'error'));
	const assembly = $derived(assemble(effective));

	// Autosave the name shortly after the last change.
	$effect(() => {
		const current = name.trim();
		if (current === lastSaved) return;
		saving = 'dirty';
		const timer = setTimeout(async () => {
			if (!current) return;
			saving = 'saving';
			try {
				await saveDevice({ id: device.id, name: current });
				lastSaved = current;
				saving = name.trim() === current ? 'saved' : 'dirty';
				saveError = '';
			} catch (e) {
				saving = 'error';
				saveError = e instanceof Error ? e.message : String(e);
			}
		}, 700);
		return () => clearTimeout(timer);
	});

	const href = (t: string) => `${path('/(app)/devices/[id]', { id: device.id })}?tab=${t}`;
	const tabs = $derived([
		{ id: 'general', label: 'General', href: href('general'), icon: Info },
		{
			id: 'device',
			label: 'Device settings',
			href: href('device'),
			icon: MemoryStick,
			badge: errors.length || undefined,
			tone: 'err' as const
		},
		{
			id: 'wiring',
			label: 'Wiring',
			href: href('wiring'),
			icon: Cable,
			badge: assembly.wires.length || undefined
		},
		{ id: 'firmware', label: 'Firmware', href: href('firmware'), icon: Zap },
		{
			id: 'api',
			label: 'REST API',
			href: href('api'),
			icon: Code,
			badge: assembly.api.length || undefined
		}
	]);
</script>

<div class="border-b border-border bg-surface">
	<div class="mx-auto max-w-7xl px-4 pt-5 sm:px-6">
		<!-- eslint-disable svelte/no-navigation-without-resolve -- built with resolve() -->
		<a
			href={device.location ? `${path('/(app)')}?location=${device.location.id}` : path('/(app)')}
			class="mb-3 inline-flex items-center gap-1 text-xs text-muted no-underline hover:text-fg"
			><ArrowLeft size={14} />{device.location?.name ?? 'Firmware'}</a
		>
		<div class="flex flex-wrap items-center gap-4">
			<div
				class={[
					'grid size-11 place-items-center rounded-xl',
					device.kind === 'hub' ? 'bg-accent text-accent-fg' : 'bg-accent-soft text-accent'
				]}
			>
				{#if device.kind === 'hub'}<Router size={22} />{:else}<Cpu size={22} />{/if}
			</div>
			<div class="min-w-0">
				<h1 class="m-0 truncate text-xl font-semibold tracking-tight">{name || device.name}</h1>
				<div class="text-xs text-muted">
					{KINDS[device.kind].name}{#if device.location}
						· {device.location.name}{/if} · runs
					<a href={path('/(app)/firmware/[id]', { id: device.firmware.id })}
						>{device.firmware.name}</a
					>{#if device.reported.main?.running}
						v{device.reported.main.running}{/if}
				</div>
			</div>
			<div class="ml-auto flex items-center gap-3 text-xs">
				{#if errors.length}<Badge tone="err"
						>{errors.length} error{errors.length > 1 ? 's' : ''}</Badge
					>{/if}
				{#if dirty}<a href={href('device')} class="no-underline"
						><Badge tone="warn">not sent to the device</Badge></a
					>{:else if saving === 'saved'}<span class="flex items-center gap-1 text-muted"
						><Check size={14} />Saved</span
					>
				{:else if saving === 'error'}<span class="text-err" title={saveError}
						>Not saved – {saveError}</span
					>
				{:else}<span class="flex items-center gap-1 text-muted"><Spinner />Saving…</span>{/if}
				<a
					href={href('firmware')}
					class={button({ variant: 'primary', size: 'sm', class: 'no-underline' })}
					><Zap size={15} />Install</a
				>
			</div>
		</div>
		<div class="mt-4"><Tabs {tabs} current={tab} /></div>
	</div>
</div>

<!-- For the whole tab: under the tabs, not in a card. -->
{#if tab === 'device'}
	<div class="sticky top-14 z-20 border-b border-border bg-surface/90 backdrop-blur">
		<div class="mx-auto max-w-7xl px-4 py-3 sm:px-6">
			<DeviceConfigState
				state={board}
				{readAt}
				error={boardError}
				{sent}
				{dirty}
				busy={sending || !!usbStep}
				blocked={errors.length
					? `Fix ${errors.length} error${errors.length > 1 ? 's' : ''} first: ${errors[0].message}`
					: undefined}
				connected={!!device.connectedSince}
				{usbStep}
				onread={readVia}
				onwrite={writeVia}
				ondiscard={discard}
			/>
		</div>
	</div>
{/if}

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	{#if tab === 'firmware'}
		<InstallPanel
			{device}
			draft={board === 'draft' && settings
				? { settings: $state.snapshot(settings), password }
				: undefined}
		/>
	{:else if tab === 'wiring'}
		<Card
			title="Wiring"
			description="How to connect boards, sensors and modules. Hover a wire to highlight it."
		>
			<WiringDiagram {assembly} />
			{#if assembly.notes.length}
				<ul class="mt-5 mb-0 grid gap-1 pl-5 text-sm text-muted">
					{#each assembly.notes as n (n)}<li>{n}</li>{/each}
				</ul>
			{/if}
		</Card>
	{:else if tab === 'api'}
		<ApiDocs
			{assembly}
			firmwareId={device.firmware.id}
			address={device.url}
			token={device.apiToken}
		/>
	{:else if tab === 'device'}
		{#if settings}<DeviceBoardSettings
				bind:password
				{settings}
				{name}
				{effective}
				{issues}
				{device}
			/>{/if}
	{:else}
		<DeviceGeneral bind:name {settings} {effective} {device} />
	{/if}
</div>
