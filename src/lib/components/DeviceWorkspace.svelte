<!-- A device: its settings (saved automatically, live checks), wiring, its firmware and installing it, its REST API, general info. -->
<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Cable from '@lucide/svelte/icons/cable';
	import Check from '@lucide/svelte/icons/check';
	import Code from '@lucide/svelte/icons/code';
	import Cpu from '@lucide/svelte/icons/cpu';
	import Router from '@lucide/svelte/icons/router';
	import Info from '@lucide/svelte/icons/info';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import Zap from '@lucide/svelte/icons/zap';
	import { untrack } from 'svelte';
	import { resolve as path } from '$app/paths';
	import { assemble } from '#lib/core/assemble.ts';
	import { effectiveConfig } from '#lib/core/device.ts';
	import { KINDS } from '#lib/core/kinds.ts';
	import type { DeviceSettings as Settings_ } from '#lib/core/model.ts';
	import { validateDevice } from '#lib/core/validate.ts';
	import { saveDevice, type getDevice } from '#lib/remote/devices.remote.ts';
	import { Badge, button, Card, Spinner, Tabs } from '#lib/ui/index.ts';
	import ApiDocs from './ApiDocs.svelte';
	import DeviceConfig from './DeviceConfig.svelte';
	import DeviceConfigState from './DeviceConfigState.svelte';
	import DeviceSettings from './DeviceSettings.svelte';
	import InstallPanel from './firmware/InstallPanel.svelte';
	import WiringDiagram from './wiring/WiringDiagram.svelte';

	type Device = Awaited<ReturnType<typeof getDevice>>;
	let { device, tab }: { device: Device; tab: string } = $props();

	let name = $state(untrack(() => device.name));
	let settings = $state<Settings_>(untrack(() => structuredClone(device.settings)));
	const snapshot = () => JSON.stringify({ name, settings });
	let lastSaved = untrack(snapshot);
	let saving = $state<'saved' | 'dirty' | 'saving' | 'error'>('saved');
	let saveError = $state('');

	const effective = $derived(
		effectiveConfig(device.firmware.config, settings, name.trim() || device.name)
	);
	const issues = $derived(
		validateDevice(device.firmware.config, settings, name.trim() || device.name)
	);
	const errors = $derived(issues.filter((i) => i.severity === 'error'));
	const assembly = $derived(assemble(effective));

	// Autosave shortly after the last change.
	$effect(() => {
		const current = snapshot();
		if (current === lastSaved) return;
		saving = 'dirty';
		const timer = setTimeout(async () => {
			if (!name.trim()) return;
			saving = 'saving';
			try {
				await saveDevice({ id: device.id, name: name.trim(), settings: $state.snapshot(settings) });
				lastSaved = current;
				saving = snapshot() === current ? 'saved' : 'dirty';
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
		{
			id: 'settings',
			label: 'Settings',
			href: href('settings'),
			icon: SlidersHorizontal,
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
		},
		{ id: 'general', label: 'General', href: href('general'), icon: Info }
	]);
</script>

<div class="border-b border-border bg-surface">
	<div class="mx-auto max-w-7xl px-4 pt-5 sm:px-6">
		<!-- eslint-disable svelte/no-navigation-without-resolve -- built with resolve() -->
		<a
			href={device.location ? `${path('/(app)')}?location=${device.location.id}` : path('/(app)')}
			class="mb-3 inline-flex items-center gap-1 text-xs text-muted no-underline hover:text-fg"
			><ArrowLeft size={14} />{device.location?.name ?? 'Devices'}</a
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
				{#if saving === 'saved'}<span class="flex items-center gap-1 text-muted"
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

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	{#if tab === 'firmware'}
		<InstallPanel
			{device}
			dirty={saving !== 'saved'}
			blocked={errors.length
				? `Fix ${errors.length} error${errors.length > 1 ? 's' : ''} under Settings first: ${errors[0].message}`
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
	{:else if tab === 'general'}
		<DeviceSettings {device} />
	{:else}
		<div class="grid gap-6">
			<DeviceConfigState
				{device}
				dirty={saving !== 'saved'}
				blocked={errors.length
					? `Fix ${errors.length} error${errors.length > 1 ? 's' : ''} first: ${errors[0].message}`
					: undefined}
			/>
			<DeviceConfig bind:name {settings} {effective} {issues} {device} />
		</div>
	{/if}
</div>
