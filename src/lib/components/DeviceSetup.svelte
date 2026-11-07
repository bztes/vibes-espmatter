<!-- The Settings tab of a firmware: name, boards, connectivity, features and peripherals, with live checks. -->
<script lang="ts">
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { CHIPS, deviceTypeNames, type FeatureDef, type Issue } from '#sdk';
	import {
		disableFeature,
		enableFeature,
		featuresFor,
		removePeripheral,
		setBoard,
		type Resolved
	} from '#lib/core/engine.ts';
	import { KINDS } from '#lib/core/kinds.ts';
	import type { FirmwareConfig } from '#lib/core/model.ts';
	import { capName, requirementIssues } from '#lib/core/validate.ts';
	import { Badge, Button, Card, Field, Input, PluginIcon, Toggle } from '#lib/ui/index.ts';
	import BoardPicker from './BoardPicker.svelte';
	import IssueList from './IssueList.svelte';
	import SettingsFields from './SettingsFields.svelte';
	import PeripheralCatalog from './PeripheralCatalog.svelte';

	let {
		config,
		resolved,
		issues
	}: { config: FirmwareConfig; resolved: Resolved; issues: Issue[] } = $props();

	const kind = $derived(KINDS[config.kind]);
	const all = $derived(featuresFor(config.kind));
	const transports = $derived(all.filter((f) => f.group === 'transport'));
	const others = $derived(all.filter((f) => f.group !== 'transport'));
	const main = $derived(resolved.slot('main'));
	let catalog = $state(false);

	const scoped = (scope: string) => issues.filter((i) => i.scope === scope && !i.field);
	const count = (scope: string, severity: Issue['severity']) =>
		issues.filter((i) => i.scope === scope && i.severity === severity).length;

	/** Why a feature can't run on the main board (hardware only – missing capabilities show as issues). */
	const hardwareBlock = (f: FeatureDef) => requirementIssues(main.board, f.requires, f.name)[0];

	function toggle(f: FeatureDef, on: boolean) {
		if (on) enableFeature(config, f.id);
		else disableFeature(config, f.id);
	}

	const caps = (chipId: keyof typeof CHIPS) =>
		CHIPS[chipId].capabilities.filter((c) =>
			['wifi', 'wifi-5ghz', 'ble', 'ieee802154', 'ethernet-mac', 'usb-otg'].includes(c)
		);
</script>

<div class="grid gap-6">
	<Card title="Identity">
		<Field label="Name" id="fw-name" help="Of the firmware. Devices have names of their own.">
			<Input id="fw-name" maxlength={48} bind:value={config.name} />
		</Field>
	</Card>

	<!-- Boards ---------------------------------------------------------------------------- -->
	<Card
		title="Boards"
		description={resolved.slots.length > 1
			? 'This device consists of several boards – each gets its own firmware.'
			: 'The ESP32 board the firmware runs on.'}
	>
		<div class="grid gap-5">
			{#each resolved.slots as slot (slot.id)}
				<div id="board:{slot.id}" class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
					<div class="grid content-start gap-1.5">
						<label for="board-{slot.id}" class="text-sm font-medium">{slot.name}</label>
						<BoardPicker
							id="board-{slot.id}"
							value={slot.board.id}
							requires={slot.id === 'main' ? kind.mainSlot.requires : slot.def?.requires}
							onchange={(id) => setBoard(config, slot.id, id)}
						/>
						{#if slot.def?.description}<p class="m-0 text-xs text-muted">
								{slot.def.description}
							</p>{/if}
					</div>
					<div class="rounded-lg bg-surface-2/70 p-3 text-xs">
						<div class="flex flex-wrap items-center gap-1.5">
							<Badge tone="accent">{slot.chip.name}</Badge>
							{#each caps(slot.chip.id) as c (c)}<Badge>{capName(c).replace(/^an? /, '')}</Badge
								>{/each}
							<Badge>{slot.board.flashMB} MB flash</Badge>
							{#if slot.board.psram !== 'none'}<Badge>{slot.board.psram} PSRAM</Badge>{/if}
							{#if slot.framework === 'esp-idf'}<Badge tone="info">ESP-IDF</Badge>{:else}<Badge
									tone="info">esp-matter</Badge
								>{/if}
						</div>
						{#if slot.board.description}<p class="mt-2 mb-0 text-muted">
								{slot.board.description}
							</p>{/if}
						{#if slot.board.url}
							<!-- eslint-disable svelte/no-navigation-without-resolve -- external datasheet link -->
							<a
								class="mt-1 inline-flex items-center gap-1"
								href={slot.board.url}
								target="_blank"
								rel="noreferrer">Datasheet <ExternalLink size={12} /></a
							>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{/if}
					</div>
					{#if scoped(`board:${slot.id}`).length}
						<div class="sm:col-span-2">
							<IssueList issues={scoped(`board:${slot.id}`)} compact />
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</Card>

	<!-- Connectivity ----------------------------------------------------------------------- -->
	<Card
		title="Connectivity"
		description={config.kind === 'hub'
			? 'How the hub reaches your network.'
			: 'How the device talks Matter.'}
	>
		<div class={['grid gap-3', transports.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2']}>
			{#each transports as f (f.id)}
				{@const on = f.id in config.features}
				{@const block = hardwareBlock(f)}
				<button
					type="button"
					disabled={!!block && !on}
					onclick={() =>
						on
							? config.kind === 'hub' && disableFeature(config, f.id)
							: enableFeature(config, f.id)}
					class={[
						'flex items-start gap-3 rounded-xl border p-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-55',
						on
							? 'border-accent bg-accent-soft/50 ring-2 ring-accent/20'
							: 'border-border hover:border-border-strong'
					]}
					title={block}
				>
					<span
						class={[
							'grid size-9 shrink-0 place-items-center rounded-lg',
							on ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted'
						]}><PluginIcon name={f.icon} /></span
					>
					<span class="grid gap-0.5">
						<span class="text-sm font-semibold">{f.name}</span>
						<span class="text-xs text-muted"
							>{block ? block.replace(/^[^:]*: t/, 'T') : f.description}</span
						>
					</span>
				</button>
			{/each}
		</div>
		{#each transports.filter((f) => f.id in config.features) as f (f.id)}
			{#if f.fields?.length}
				<div id="feature:{f.id}" class="mt-5 border-t border-border pt-5">
					<SettingsFields
						fields={f.fields}
						settings={config.features[f.id]}
						{config}
						{resolved}
						{issues}
						scope="feature:{f.id}"
					/>
				</div>
			{/if}
			{#if scoped(`feature:${f.id}`).length}<div class="mt-3">
					<IssueList issues={scoped(`feature:${f.id}`)} compact />
				</div>{/if}
		{/each}
	</Card>

	<!-- Peripherals ----------------------------------------------------------------------------- -->
	{#if kind.peripherals}
		<Card
			title="Peripherals"
			description="What is attached to the device. Each peripheral is independent and gets its own Matter endpoint(s)."
		>
			{#snippet actions()}
				<Button size="sm" variant="primary" onclick={() => (catalog = true)}
					><Plus size={15} />Add peripheral</Button
				>
			{/snippet}
			{#if !resolved.peripherals.length}
				<div class="grid place-items-center gap-2 py-6 text-center">
					<p class="m-0 text-sm text-muted">
						No peripherals yet. Add a sensor, a relay or an appliance.
					</p>
					<Button size="sm" onclick={() => (catalog = true)}
						><Plus size={15} />Add peripheral</Button
					>
				</div>
			{/if}
			<div class="grid gap-4">
				{#each resolved.peripherals as s (s.instance.uid)}
					{@const scope = `peripheral:${s.instance.uid}`}
					<div
						id={scope}
						class={[
							'rounded-xl border p-4',
							count(scope, 'error') ? 'border-err/40' : 'border-border'
						]}
					>
						<div class="mb-4 flex items-start gap-3">
							<span
								class="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"
								><PluginIcon name={s.def.icon} /></span
							>
							<div class="grid min-w-0 flex-1 gap-1">
								<Input
									class="h-8 max-w-xs font-semibold"
									aria-label="Name"
									maxlength={32}
									bind:value={
										() => s.instance.name,
										(v) => (config.peripherals.find((x) => x.uid === s.instance.uid)!.name = v)
									}
								/>
								<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
									<span>{s.def.name}</span>·
									<span
										>endpoint {s.endpoint}{s.def.matter.endpoints.length > 1
											? `–${s.endpoint + s.def.matter.endpoints.length - 1}`
											: ''}</span
									>·
									<span>{deviceTypeNames(s.def.matter.endpoints, ', ')}</span>
								</div>
							</div>
							<Button
								size="icon"
								variant="ghost"
								aria-label="Remove {s.instance.name}"
								onclick={() => removePeripheral(config, s.instance.uid)}
								><Trash2 size={16} /></Button
							>
						</div>
						<SettingsFields
							fields={s.def.fields}
							settings={config.peripherals.find((x) => x.uid === s.instance.uid)!.settings}
							{config}
							{resolved}
							{issues}
							{scope}
						/>
						{#if scoped(scope).length}<div class="mt-3">
								<IssueList issues={scoped(scope)} compact />
							</div>{/if}
					</div>
				{/each}
			</div>
		</Card>
	{/if}

	<!-- Features --------------------------------------------------------------------------- -->
	<Card
		title="Features"
		description="Optional parts of the firmware. They don’t depend on each other – only on what is there (an IP network, a Thread network …)."
	>
		<div class="grid divide-y divide-border">
			{#each others as f (f.id)}
				{@const on = f.id in config.features}
				{@const block = hardwareBlock(f)}
				{@const scope = `feature:${f.id}`}
				<div id={scope} class="py-4 first:pt-0 last:pb-0">
					<div class="flex items-start gap-3">
						<span
							class={[
								'grid size-9 shrink-0 place-items-center rounded-lg',
								on ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted'
							]}><PluginIcon name={f.icon} /></span
						>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-sm font-semibold">{f.name}</span>
								{#if on && count(scope, 'error')}<Badge tone="err"
										>{count(scope, 'error')} error{count(scope, 'error') > 1 ? 's' : ''}</Badge
									>{/if}
								{#each f.slots ?? [] as slot (slot.id)}<Badge tone="info">+ {slot.name}</Badge
									>{/each}
							</div>
							<p class="mt-0.5 mb-0 text-xs text-muted">{block ?? f.description}</p>
						</div>
						<Toggle
							label={f.name}
							checked={on}
							disabled={!!block && !on}
							onchange={(v) => toggle(f, v)}
						/>
					</div>
					{#if on && (f.fields?.length || scoped(scope).length)}
						<div class="mt-4 ml-12">
							<SettingsFields
								fields={f.fields}
								settings={config.features[f.id]}
								{config}
								{resolved}
								{issues}
								{scope}
							/>
							{#if scoped(scope).length}<div class="mt-3">
									<IssueList issues={scoped(scope)} compact />
								</div>{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</Card>
</div>

<PeripheralCatalog bind:open={catalog} {config} {resolved} />
