<!--
	Renders a plugin's declarative fields. Plugins never ship their own editors.
	On a firmware: per-device fields are marked (their values are the defaults of its devices).
	On a device (`onset`): changes go to the device, and each field shows where its value comes from.
-->
<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { Field as FieldDef, GpioField, Issue, Settings, SettingValue } from '#sdk';
	import {
		boardGpios,
		pinFields,
		pinLabel,
		pinProblem,
		pinWarning,
		type Resolved
	} from '#lib/core/engine.ts';
	import type { FirmwareConfig } from '#lib/core/model.ts';
	import { Button, Field, Input, Select, Toggle } from '#lib/ui/index.ts';

	let {
		fields = [],
		settings,
		config,
		resolved,
		issues,
		scope,
		onset,
		origin,
		onreset
	}: {
		fields?: FieldDef[];
		settings: Settings;
		config: FirmwareConfig;
		resolved: Resolved;
		issues: Issue[];
		scope: string;
		/** Device mode: called instead of changing `settings`. */
		onset?: (key: string, value: SettingValue) => void;
		origin?: (key: string) => 'device' | 'firmware';
		onreset?: (key: string) => void;
	} = $props();

	const set = (key: string, value: SettingValue) =>
		onset ? onset(key, value) : (settings[key] = value);

	const visible = $derived(fields.filter((f) => !f.when || f.when(settings)));
	const basic = $derived(visible.filter((f) => !f.advanced));
	const advanced = $derived(visible.filter((f) => f.advanced));
	const issueOf = (key: string, severity: Issue['severity']) =>
		issues.find((i) => i.scope === scope && i.field === key && i.severity === severity)?.message;
	const id = (key: string) => `${scope}-${key}`.replace(/[^\w-]/g, '-');

	/** Pin options of a GPIO field: every GPIO of the board, with why it can't or shouldn't be used. */
	function pinOptions(field: GpioField) {
		const slot = resolved.slot(field.slot);
		const others = pinFields(config).filter(
			(e) => !(e.settings === settings && e.field.key === field.key)
		);
		return boardGpios(slot.board).map((gpio) => {
			const problem = pinProblem(slot.board, gpio, field.use, {
				wifi: resolved.has('wifi') && slot.id === 'main'
			});
			const user = others.find(
				(e) => (e.field.slot ?? 'main') === slot.id && Number(e.settings[e.field.key]) === gpio
			);
			const shared = user && field.role?.startsWith('i2c-') && user.field.role === field.role;
			const warning = pinWarning(slot.board, gpio);
			const note = problem
				? problem.replace(/^GPIO\d+ /, '')
				: user
					? `${shared ? 'shared with' : 'used by'} ${user.owner}`
					: warning
						? '⚠'
						: '';
			return { gpio, label: pinLabel(slot.board, gpio), disabled: !!problem, note };
		});
	}
</script>

{#snippet control(f: FieldDef)}
	{#if f.type === 'boolean'}
		<div class="flex items-start gap-3 sm:col-span-2">
			<Toggle label={f.label} bind:checked={() => !!settings[f.key], (v) => set(f.key, v)} />
			<div>
				<div class="text-sm font-medium">{f.label}{@render hint(f)}</div>
				{#if f.help}<div class="text-xs text-muted">{f.help}</div>{/if}
			</div>
		</div>
	{:else}
		<Field
			label={f.label}
			id={id(f.key)}
			help={f.help}
			error={issueOf(f.key, 'error')}
			warning={issueOf(f.key, 'warning')}
		>
			{#snippet extra()}{@render hint(f)}{/snippet}
			{#if f.type === 'text'}
				<Input
					id={id(f.key)}
					type={f.secret ? 'password' : 'text'}
					autocomplete="off"
					invalid={!!issueOf(f.key, 'error')}
					placeholder={f.placeholder}
					maxlength={f.maxLength}
					bind:value={() => String(settings[f.key] ?? ''), (v) => set(f.key, v)}
				/>
			{:else if f.type === 'number'}
				<div class="relative">
					<Input
						id={id(f.key)}
						type="number"
						invalid={!!issueOf(f.key, 'error')}
						class={f.unit ? 'pr-10' : ''}
						min={f.min}
						max={f.max}
						step={f.step ?? (f.integer ? 1 : 'any')}
						bind:value={() => Number(settings[f.key]), (v) => set(f.key, Number(v))}
					/>
					{#if f.unit}<span
							class="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs text-muted"
							>{f.unit}</span
						>{/if}
				</div>
			{:else if f.type === 'select'}
				<Select id={id(f.key)} bind:value={() => String(settings[f.key]), (v) => set(f.key, v)}>
					{#each f.options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
				</Select>
			{:else if f.type === 'gpio'}
				<Select
					id={id(f.key)}
					invalid={!!issueOf(f.key, 'error')}
					mono
					bind:value={() => Number(settings[f.key]), (v) => set(f.key, Number(v))}
				>
					<option value={-1}>{f.optional ? '— not connected —' : '— pick a pin —'}</option>
					{#each pinOptions(f) as o (o.gpio)}
						<option value={o.gpio} disabled={o.disabled}
							>{o.label}{o.note ? `  · ${o.note}` : ''}</option
						>
					{/each}
				</Select>
			{/if}
		</Field>
	{/if}
{/snippet}

{#snippet hint(f: FieldDef)}
	{#if onset && origin}
		{@const from = origin(f.key)}
		{#if from === 'device'}
			<Button variant="link" size="sm" class="ml-2 font-normal" onclick={() => onreset?.(f.key)}
				>reset</Button
			>
		{:else}
			<span class="ml-2 text-xs font-normal text-muted">firmware default</span>
		{/if}
	{:else if f.perDevice}
		<span
			class="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent"
			title="Each device can have its own value; this is the default for devices of this firmware."
			>per device</span
		>
	{/if}
{/snippet}

{#if basic.length}
	<div class="grid gap-4 sm:grid-cols-2">
		{#each basic as f (f.key)}{@render control(f)}{/each}
	</div>
{/if}
{#if advanced.length}
	<details class="group mt-4">
		<summary
			class="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted select-none hover:text-fg"
		>
			<ChevronRight size={14} class="transition-transform group-open:rotate-90" />Advanced ({advanced.length})
		</summary>
		<div class="mt-3 grid gap-4 sm:grid-cols-2">
			{#each advanced as f (f.key)}{@render control(f)}{/each}
		</div>
	</details>
{/if}
