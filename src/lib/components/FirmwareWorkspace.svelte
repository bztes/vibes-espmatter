<!-- Editing a firmware: the configuration is edited locally (live checks) and saved automatically. -->
<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Cable from '@lucide/svelte/icons/cable';
	import Check from '@lucide/svelte/icons/check';
	import Code from '@lucide/svelte/icons/code';
	import Cpu from '@lucide/svelte/icons/cpu';
	import Info from '@lucide/svelte/icons/info';
	import Router from '@lucide/svelte/icons/router';
	import Boxes from '@lucide/svelte/icons/boxes';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import Zap from '@lucide/svelte/icons/zap';
	import { untrack } from 'svelte';
	import { resolve as path } from '$app/paths';
	import type { Issue } from '#sdk';
	import { assemble } from '#lib/core/assemble.ts';
	import { pinFields, pinLabel, resolve } from '#lib/core/engine.ts';
	import { KINDS } from '#lib/core/kinds.ts';
	import type { FirmwareConfig } from '#lib/core/model.ts';
	import { validate } from '#lib/core/validate.ts';
	import { saveFirmware, type getFirmware } from '#lib/remote/firmware.remote.ts';
	import { Badge, button, Card, Spinner, Tabs } from '#lib/ui/index.ts';
	import ApiDocs from './ApiDocs.svelte';
	import DeviceSetup from './DeviceSetup.svelte';
	import BuildPanel from './firmware/BuildPanel.svelte';
	import FirmwareDevices from './FirmwareDevices.svelte';
	import FirmwareSettings from './FirmwareSettings.svelte';
	import IssueList from './IssueList.svelte';
	import WiringDiagram from './wiring/WiringDiagram.svelte';

	type Firmware = Awaited<ReturnType<typeof getFirmware>>;
	let { firmware, tab }: { firmware: Firmware; tab: string } = $props();

	let config = $state<FirmwareConfig>(untrack(() => structuredClone(firmware.config)));
	let lastSaved = untrack(() => JSON.stringify(firmware.config));
	let saving = $state<'saved' | 'dirty' | 'saving' | 'error'>('saved');
	let saveError = $state('');

	const resolved = $derived(resolve(config));
	const issues = $derived(validate(config, resolved));
	const assembly = $derived(assemble(config));
	const errors = $derived(issues.filter((i) => i.severity === 'error'));
	const warnings = $derived(issues.filter((i) => i.severity === 'warning'));

	// Autosave shortly after the last change.
	$effect(() => {
		const snapshot = JSON.stringify(config);
		if (snapshot === lastSaved) return;
		saving = 'dirty';
		const timer = setTimeout(async () => {
			saving = 'saving';
			try {
				await saveFirmware({ id: firmware.id, config: $state.snapshot(config) });
				lastSaved = snapshot;
				saving = JSON.stringify(config) === snapshot ? 'saved' : 'dirty';
				saveError = '';
			} catch (e) {
				saving = 'error';
				saveError = e instanceof Error ? e.message : String(e);
			}
		}, 700);
		return () => clearTimeout(timer);
	});

	const href = (t: string) => `${path('/(app)/firmware/[id]', { id: firmware.id })}?tab=${t}`;
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
		{
			id: 'api',
			label: 'REST API',
			href: href('api'),
			icon: Code,
			badge: assembly.api.length || undefined
		},
		{ id: 'build', label: 'Build', href: href('build'), icon: Zap },
		{
			id: 'devices',
			label: 'Devices',
			href: href('devices'),
			icon: Boxes,
			badge: firmware.devices.length || undefined
		},
		{ id: 'general', label: 'General', href: href('general'), icon: Info }
	]);

	const pinsBySlot = $derived(
		resolved.slots.map((slot) => ({
			slot,
			pins: pinFields(config)
				.filter((e) => (e.field.slot ?? 'main') === slot.id && Number(e.settings[e.field.key]) >= 0)
				.map((e) => ({
					gpio: Number(e.settings[e.field.key]),
					label: pinLabel(slot.board, Number(e.settings[e.field.key])),
					owner: e.owner,
					what: e.field.label
				}))
				.sort((a, b) => a.gpio - b.gpio)
		}))
	);

	function focus(issue: Issue) {
		if (tab !== 'settings') return;
		const el = document.getElementById(
			issue.scope === 'device' ? 'board:main' : (issue.scope ?? '')
		);
		el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		el?.classList.add('ring-2', 'ring-accent/40');
		setTimeout(() => el?.classList.remove('ring-2', 'ring-accent/40'), 1500);
	}
</script>

<div class="border-b border-border bg-surface">
	<div class="mx-auto max-w-7xl px-4 pt-5 sm:px-6">
		<!-- eslint-disable svelte/no-navigation-without-resolve -- built with resolve() -->
		<a
			href={path('/(app)/firmware')}
			class="mb-3 inline-flex items-center gap-1 text-xs text-muted no-underline hover:text-fg"
			><ArrowLeft size={14} />Firmware</a
		>
		<div class="flex flex-wrap items-center gap-4">
			<div
				class={[
					'grid size-11 shrink-0 place-items-center rounded-xl',
					config.kind === 'hub' ? 'bg-accent text-accent-fg' : 'bg-accent-soft text-accent'
				]}
			>
				{#if config.kind === 'hub'}<Router size={22} />{:else}<Cpu size={22} />{/if}
			</div>
			<div class="min-w-0">
				<h1 class="m-0 truncate text-xl font-semibold tracking-tight">{config.name}</h1>
				<div class="text-xs text-muted">
					{KINDS[config.kind].name} firmware · {resolved.slots.map((s) => s.board.name).join(' + ')} ·
					{firmware.devices.length} device{firmware.devices.length === 1 ? '' : 's'}
				</div>
			</div>
			<div class="ml-auto flex items-center gap-3 text-xs">
				{#if saving === 'saved'}<span class="flex items-center gap-1 text-muted"
						><Check size={14} />Saved</span
					>
				{:else if saving === 'error'}<span class="text-err" title={saveError}
						>Not saved – {saveError}</span
					>
				{:else}<span class="flex items-center gap-1 text-muted"><Spinner />Saving…</span>{/if}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built with resolve() in href() -->
				<a
					href={href('build')}
					class={button({ variant: 'primary', size: 'sm', class: 'no-underline' })}
					><Zap size={15} />Build</a
				>
			</div>
		</div>
		<div class="mt-4"><Tabs {tabs} current={tab} /></div>
	</div>
</div>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	{#if tab === 'settings'}
		<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
			<DeviceSetup {config} {resolved} {issues} />
			<aside
				class="grid content-start gap-6 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
			>
				<Card
					title="Checks"
					description={errors.length ? 'Errors block the build.' : 'Ready to build.'}
				>
					{#snippet actions()}
						<div class="flex gap-1">
							{#if errors.length}<Badge tone="err">{errors.length}</Badge>{/if}
							{#if warnings.length}<Badge tone="warn">{warnings.length}</Badge>{/if}
							{#if !errors.length && !warnings.length}<Badge tone="ok">all good</Badge>{/if}
						</div>
					{/snippet}
					{#if issues.length}<IssueList {issues} onselect={focus} />{:else}<p
							class="m-0 text-sm text-muted"
						>
							No problems found.
						</p>{/if}
				</Card>
				{#each pinsBySlot as { slot, pins } (slot.id)}
					{#if pins.length}
						<Card title="Pins · {slot.name}" flush>
							<table class="w-full text-xs">
								<tbody>
									{#each pins as p, i (i)}
										<tr class="border-t border-border first:border-0">
											<td class="py-1.5 pl-5 font-mono font-semibold whitespace-nowrap"
												>{p.label}</td
											>
											<td class="py-1.5 pr-5 text-muted"
												><span class="text-fg">{p.owner}</span> · {p.what}</td
											>
										</tr>
									{/each}
								</tbody>
							</table>
						</Card>
					{/if}
				{/each}
			</aside>
		</div>
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
		<ApiDocs {assembly} firmwareId={firmware.id} />
	{:else if tab === 'build'}
		<BuildPanel
			firmwareId={firmware.id}
			blocked={errors.length
				? `Fix ${errors.length} error${errors.length > 1 ? 's' : ''} under Settings first.`
				: undefined}
			dirty={saving !== 'saved'}
			nextVersion={firmware.nextVersion}
		/>
	{:else if tab === 'devices'}
		<FirmwareDevices {firmware} />
	{:else if tab === 'general'}
		<FirmwareSettings {config} {firmware} />
	{/if}
</div>
