<!--
  Makes or edits an automation in two steps: what starts it, then the details (when, then, name).
  Editing opens at the details; Change goes back to the kind. Only what the account may use is offered.
  Up to `MAX_ACTIONS` actions run in order.
-->
<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Plus from '@lucide/svelte/icons/plus';
	import { api, Button, Dialog, errorText, Input, Notice, Segmented, Select } from '#sdk/device-ui';
	import { untrack } from 'svelte';
	import ActionEditor from './ActionEditor.svelte';
	import Dial from './Dial.svelte';
	import { MAX_ACTIONS, draftOf, editable, resolve, type Draft } from './drafts';
	import { choice, panel, side, withUnit } from './styles';
	import { STATE_THRESHOLD, watchesFor, type Cmp } from './watches';
	import {
		EVERY_DAY,
		WEEKDAYS,
		WEEKEND,
		WORKDAYS,
		deviceGroups,
		fromLocal,
		inText,
		localParts,
		onceText,
		splitKey,
		timeText,
		type Gesture,
		type Rule,
		type Trigger
	} from './automations';
	import { GESTURES, KINDS, actionText, whenText, type Kind, type Lists } from './describe';

	let {
		rule,
		lists,
		now: hubNow,
		onclose,
		onsaved
	}: {
		/** Missing: a new automation. */
		rule?: Rule;
		lists: Lists;
		/** The hub's Unix time. */
		now?: number;
		onclose: () => void;
		onsaved: (text: string) => void;
	} = $props();

	const MULTI_PRESS = 0x10;
	const IN_PRESETS = [5, 10, 15, 30, 60, 120];
	const DAY_PRESETS = [
		{ days: EVERY_DAY, label: 'Every day' },
		{ days: WORKDAYS, label: 'Mon–Fri' },
		{ days: WEEKEND, label: 'Weekend' }
	];
	const missingText: Partial<Record<Kind, string>> = {
		button: 'Pair a switch or remote (a device with buttons) first.',
		value: 'Pair a sensor first.'
	};

	const now = $derived(hubNow ?? Date.now() / 1000);

	// Starts from the rule; later changes of the prop don't reset the form.
	const start = untrack(() => rule);
	const t0 = start?.trigger;
	/** A one-off's time, or the next full hour plus one. */
	const at0 = localParts(
		t0?.type === 'once' && t0.at > Date.now() / 1000
			? t0.at
			: Math.ceil(Date.now() / 3600000) * 3600 + 3600
	);

	let open = $state(true);
	let step = $state<1 | 2>(start ? 2 : 1);
	let confirmDelete = $state(false);
	let name = $state(start?.name ?? '');
	let kind = $state<Kind>(t0 && t0.type !== 'unknown' ? t0.type : 'time');

	let minute = $state(t0?.type === 'time' ? t0.minute : 7 * 60);
	let days = $state(t0?.type === 'time' ? t0.days : EVERY_DAY);
	let onceMode = $state<'in' | 'at'>(t0?.type === 'once' ? 'at' : 'in');
	let inMinutes = $state(15);
	let atDay = $state(at0.day);
	let atMinute = $state(at0.minute);
	let button = $state(t0?.type === 'button' ? `${t0.node}:${t0.endpoint}` : '');
	let pickedGesture = $state<Gesture>(t0?.type === 'button' ? t0.gesture : 'press');
	let sensor = $state(t0?.type === 'value' ? `${t0.node}:${t0.endpoint}` : '');
	let pickedWatch = $state(t0?.type === 'value' ? t0.key : '');
	let cmp = $state<Cmp>(t0?.type === 'value' && t0.above !== undefined ? 'above' : 'below');
	/** Undefined: the watch's suggestion. */
	let pickedThreshold = $state(t0?.type === 'value' ? (t0.below ?? t0.above) : undefined);
	let forMinutes = $state(t0?.type === 'value' ? Math.round((t0.for ?? 0) / 60) : 0);

	let drafts = $state<Draft[]>(
		untrack(() => {
			const shown = start?.actions.filter(editable) ?? [];
			return shown.length ? shown.map((a) => draftOf(a, lists)) : [draftOf(undefined, lists)];
		})
	);
	/** Kept as they are. */
	const hidden = start?.actions.filter((a) => !editable(a)) ?? [];

	let busy = $state(false);
	let error = $state<string>();

	const sensorGroups = $derived(deviceGroups(lists.sensors));
	const buttonGroups = $derived(deviceGroups(lists.buttons));

	const missing = (k: Kind) =>
		(k === 'button' && !lists.buttons.length) || (k === 'value' && !lists.sensors.length);
	const kindDef = $derived(KINDS.find((k) => k.id === kind)!);

	// Button
	const noDouble = $derived.by(() => {
		const features = lists.buttons.find((b) => b.key === button)?.ep.switchFeatures ?? 0;
		return features !== 0 && !(features & MULTI_PRESS);
	});
	/** The picked gesture, or a press when the button can't do a double press. */
	const gesture = $derived(noDouble && pickedGesture === 'double' ? 'press' : pickedGesture);

	// Sensor
	const sensorEp = $derived(lists.sensors.find((s) => s.key === sensor)?.ep);
	const watches = $derived(sensorEp ? watchesFor(sensorEp) : []);
	/** The picked value, or the sensor's first one. */
	const watch = $derived(watches.find((w) => w.key === pickedWatch) ?? watches[0]);
	const states = $derived(watch?.kind === 'state' && sensorEp ? watch.states(sensorEp) : []);
	const threshold = $derived(
		watch?.kind === 'number' ? (pickedThreshold ?? watch.initial) : STATE_THRESHOLD
	);

	// Once
	const atUnix = $derived(atDay ? fromLocal(atDay, atMinute) : 0);
	const today = $derived(localParts(now).day);
	const tomorrow = $derived(localParts(now + 86400).day);

	// Actions
	const held = $derived(kind === 'button' && gesture === 'hold');
	const resolved = $derived(drafts.map((d) => resolve(d, lists, held)));
	const canAdd = $derived(drafts.length + hidden.length < MAX_ACTIONS);

	const triggerReady = $derived(
		kind === 'time'
			? days !== 0
			: kind === 'once'
				? onceMode === 'in'
					? inMinutes >= 1
					: atUnix > Date.now() / 1000
				: kind === 'value'
					? !!watch && Number.isFinite(threshold)
					: !!button
	);
	const actionReady = $derived(resolved.every((r) => r.action));

	/** The trigger to store; a countdown as the hub takes it. */
	function trigger() {
		if (kind === 'time') return { type: 'time', minute, days };
		if (kind === 'once')
			return onceMode === 'in' ? { type: 'once', in: inMinutes } : { type: 'once', at: atUnix };
		if (kind === 'value') {
			const [node, endpoint] = splitKey(sensor);
			return {
				type: 'value',
				node,
				endpoint,
				key: watch.key,
				[cmp]: threshold,
				hysteresis: watch.kind === 'number' ? watch.hysteresis : 0,
				for: forMinutes * 60
			};
		}
		const [node, endpoint] = splitKey(button);
		return { type: 'button', node, endpoint, gesture };
	}

	const whenSummary = $derived.by(() => {
		if (!triggerReady) return undefined;
		const t = trigger();
		const shown = (
			t.type === 'once' && 'in' in t ? { type: 'once', at: Math.floor(now) + inMinutes * 60 } : t
		) as Trigger;
		return whenText(shown, lists, now);
	});
	const thenSummary = $derived(
		actionReady ? resolved.map((r) => actionText(r.action!, lists)).join(', ') : undefined
	);

	const addAction = () => drafts.push(draftOf(undefined, lists));
	const removeAction = (id: number) => (drafts = drafts.filter((d) => d.id !== id));

	function close() {
		open = false;
		onclose();
	}

	function pick(k: Kind) {
		kind = k;
		step = 2;
	}

	async function run(fn: () => Promise<unknown>, done: string) {
		busy = true;
		error = undefined;
		try {
			await fn();
			onsaved(done);
			close();
		} catch (e) {
			error = errorText(e);
		} finally {
			busy = false;
		}
	}

	function save() {
		if (step === 1 || !triggerReady || !actionReady) return;
		const actions = [...resolved.map((r) => r.action!), ...hidden];
		// A new time for a one-off: it runs again.
		const enabled = kind === 'once' ? true : undefined;
		const body = { name: name.trim(), enabled, trigger: trigger(), actions };
		void run(
			() =>
				start
					? api(`/api/v1/controller/automations/${start.id}`, { method: 'PUT', body })
					: api('/api/v1/controller/automations', { body }),
			start ? 'Automation saved.' : 'Automation added.'
		);
	}

	const remove = (id: number) =>
		run(
			() => api(`/api/v1/controller/automations/${id}`, { method: 'DELETE' }),
			'Automation deleted.'
		);

	const duration = (v: number): [string, string] => {
		if (v < 60) return [String(v), 'min'];
		const m = v % 60;
		return [`${Math.floor(v / 60)} h`, m ? `${m} min` : ''];
	};
	const durationStep = (v: number) => (v < 60 ? 1 : 5);
	const clock = (v: number): [string, string] => [timeText(v), ''];

	const card = 'grid gap-3 rounded-xl border border-border bg-surface-2/40 p-3';
	const cardHead = 'flex min-h-7 items-center justify-between gap-2';
	const cardTitle =
		'flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase';
	const hint = 'm-0 text-xs text-muted';
	const kindCard = (on: boolean) =>
		[
			'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:border-accent hover:bg-accent-soft/40 disabled:pointer-events-none disabled:opacity-50',
			on ? 'border-accent bg-accent-soft/40' : 'border-border-strong bg-surface'
		].join(' ');
</script>

<Dialog
	bind:open
	wide
	title={start ? 'Edit automation' : 'New automation'}
	onsubmit={save}
	onclose={close}
>
	{#if step === 1}
		<div class="grid gap-2">
			<p class="m-0 text-sm text-muted">What starts it?</p>
			{#each KINDS as k (k.id)}
				{@const on = !!start && k.id === kind}
				<button
					type="button"
					class={kindCard(on)}
					disabled={missing(k.id)}
					aria-pressed={on}
					onclick={() => pick(k.id)}
				>
					<span
						class="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"
					>
						<k.icon size={18} />
					</span>
					<span class="grid min-w-0 flex-1">
						<span class="text-sm font-semibold">{k.title}</span>
						<span class="text-xs text-muted">{missing(k.id) ? missingText[k.id] : k.text}</span>
					</span>
					{#if on}<Check size={18} class="text-accent" />{:else}<ChevronRight
							size={18}
							class="text-muted"
						/>{/if}
				</button>
			{/each}
		</div>
	{:else}
		<div class="grid gap-3">
			<Input
				maxlength={31}
				aria-label="Name"
				bind:value={name}
				placeholder="Name (optional), e.g. Morning"
			/>
			<section class={card} aria-label="When">
				<header class={cardHead}>
					<span class={cardTitle}><kindDef.icon size={14} /> When · {kindDef.title}</span>
					<button
						type="button"
						class="rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft"
						onclick={() => (step = 1)}>Change</button
					>
				</header>

				{#if kind === 'time'}
					<div class={panel}>
						<Dial
							bind:value={minute}
							min={0}
							max={1439}
							step={5}
							turn={720}
							wrap={1440}
							label="Time"
							format={clock}
						/>
						<div class={side}>
							<div class="grid grid-cols-7 gap-1" role="group" aria-label="Days">
								{#each [1, 2, 3, 4, 5, 6, 0] as d (d)}
									<button
										type="button"
										class={choice(!!(days & (1 << d)))}
										aria-pressed={!!(days & (1 << d))}
										onclick={() => (days ^= 1 << d)}>{WEEKDAYS[d]}</button
									>
								{/each}
							</div>
							<div class="grid grid-cols-3 gap-1">
								{#each DAY_PRESETS as p (p.days)}
									<button
										type="button"
										class={choice(days === p.days)}
										onclick={() => (days = p.days)}>{p.label}</button
									>
								{/each}
							</div>
							{#if !days}<p class="m-0 text-xs text-warn">Pick at least one day.</p>{/if}
						</div>
					</div>
				{:else if kind === 'once'}
					<Segmented
						label="When"
						bind:value={() => onceMode, (v) => (onceMode = v as 'in' | 'at')}
						options={[
							{ value: 'in', label: 'Countdown' },
							{ value: 'at', label: 'Date and time' }
						]}
					/>
					<div class={panel}>
						{#if onceMode === 'in'}
							<Dial
								bind:value={inMinutes}
								min={1}
								max={720}
								step={durationStep}
								turn={60}
								label="From now"
								format={duration}
							/>
							<div class={side}>
								<div class="grid grid-cols-3 gap-1">
									{#each IN_PRESETS as n (n)}
										<button
											type="button"
											class={choice(inMinutes === n)}
											onclick={() => (inMinutes = n)}>{n < 60 ? `${n} min` : `${n / 60} h`}</button
										>
									{/each}
								</div>
								<p class="m-0 text-sm text-muted">
									Runs at <span class="font-medium text-fg"
										>{onceText(now + inMinutes * 60, now)}</span
									>
								</p>
							</div>
						{:else}
							<Dial
								bind:value={atMinute}
								min={0}
								max={1439}
								step={5}
								turn={720}
								wrap={1440}
								label="Time"
								format={clock}
							/>
							<div class={side}>
								<div class="grid grid-cols-3 gap-1">
									<button
										type="button"
										class={choice(atDay === today)}
										onclick={() => (atDay = today)}>Today</button
									>
									<button
										type="button"
										class={choice(atDay === tomorrow)}
										onclick={() => (atDay = tomorrow)}>Tomorrow</button
									>
									<input
										type="date"
										class="{choice(atDay !== today && atDay !== tomorrow)} px-1"
										aria-label="Date"
										min={today}
										bind:value={atDay}
										required
									/>
								</div>
								{#if atUnix > Date.now() / 1000}
									<p class="m-0 text-sm text-muted">
										Runs <span class="font-medium text-fg">{onceText(atUnix, now)}</span>, {inText(
											atUnix - now
										)}
									</p>
								{:else}
									<p class="m-0 text-sm text-warn">That time has passed.</p>
								{/if}
							</div>
						{/if}
					</div>
					<p class={hint}>Runs once, then switches itself off.</p>
				{:else if kind === 'value'}
					<div class="grid gap-2 {watches.length > 1 ? 'sm:grid-cols-2' : ''}">
						<Select
							aria-label="Device"
							placeholder="Device…"
							value={sensor}
							groups={sensorGroups}
							onchange={({ currentTarget: { value: v } }) => (
								(sensor = v),
								(pickedWatch = ''),
								(pickedThreshold = undefined)
							)}
						/>
						{#if sensorEp && watches.length > 1}
							<Select
								aria-label="Value"
								value={watch?.key ?? ''}
								groups={[
									{
										label: '',
										options: watches.map((w) => ({ value: w.key, label: w.label(sensorEp) }))
									}
								]}
								onchange={({ currentTarget: { value: v } }) => (
									(pickedWatch = v),
									(pickedThreshold = undefined)
								)}
							/>
						{/if}
					</div>
					{#if sensorEp && watch}
						<div class={panel}>
							<div class="flex gap-3">
								{#if watch.kind === 'number'}
									<Dial
										bind:value={() => threshold, (v) => (pickedThreshold = v)}
										min={watch.min}
										max={watch.max}
										step={watch.step}
										label={watch.label(sensorEp)}
										format={withUnit(watch.unit)}
									/>
								{/if}
								<Dial
									bind:value={forMinutes}
									min={0}
									max={1440}
									step={durationStep}
									turn={60}
									label="Held for"
									format={duration}
								/>
							</div>
							<div class={side}>
								<Segmented
									label="Condition"
									bind:value={() => cmp, (v) => (cmp = v as Cmp)}
									options={watch.kind === 'number'
										? [
												{ value: 'below', label: 'Drops below' },
												{ value: 'above', label: 'Rises above' }
											]
										: states.map((s) => ({ value: s.cmp, label: s.label }))}
								/>
								<p class={hint}>Runs when it gets there, again only after it went back.</p>
							</div>
						</div>
					{/if}
				{:else}
					<Select
						aria-label="Button"
						placeholder="Button…"
						value={button}
						groups={buttonGroups}
						onchange={({ currentTarget: { value: v } }) => (button = v)}
					/>
					{#if button}
						<Segmented
							label="Gesture"
							bind:value={() => gesture, (g) => (pickedGesture = g as Gesture)}
							options={GESTURES.filter((g) => g.id !== 'double' || !noDouble).map((g) => ({
								value: g.id,
								label: g.short
							}))}
						/>
					{/if}
				{/if}
			</section>

			<section class={card} aria-label="Then">
				<header class={cardHead}>
					<span class={cardTitle}>Then</span>
				</header>
				{#each drafts as d, i (d.id)}
					{#if i}<hr class="m-0 border-border" />{/if}
					<ActionEditor
						bind:draft={drafts[i]}
						resolved={resolved[i]}
						{lists}
						label="Action {i + 1}"
						onremove={drafts.length > 1 ? () => removeAction(d.id) : undefined}
					/>
				{/each}
				{#if canAdd}
					<button
						type="button"
						class="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong py-1.5 text-xs font-medium text-muted hover:border-accent hover:text-accent"
						onclick={addAction}><Plus size={14} /> Add action</button
					>
				{/if}
			</section>

			{#if whenSummary && thenSummary}
				<p class="m-0 rounded-lg bg-accent-soft/60 px-3 py-2 text-sm" aria-live="polite">
					<span class="font-semibold">{whenSummary}</span>
					<span class="text-muted">→</span>
					{thenSummary}
				</p>
			{/if}
			{#if error}<Notice tone="err">{error}</Notice>{/if}
		</div>
	{/if}
	{#snippet footer()}
		{#if step === 1}
			{#if start}
				<Button variant="ghost" onclick={() => (step = 2)}><ArrowLeft size={16} /> Back</Button>
			{/if}
			<Button variant="ghost" onclick={close}>Cancel</Button>
		{:else}
			<Button variant="primary" type="submit" disabled={busy || !triggerReady || !actionReady}
				>{start ? 'Save' : 'Add automation'}</Button
			>
			{#if start}
				<Button variant="ghost" onclick={close}>Cancel</Button>
				{#if confirmDelete}
					<Button variant="danger" class="ml-auto" disabled={busy} onclick={() => remove(start.id)}
						>Delete automation</Button
					>
				{:else}
					<Button variant="ghost" class="ml-auto text-err" onclick={() => (confirmDelete = true)}
						>Delete…</Button
					>
				{/if}
			{:else}
				<Button variant="ghost" onclick={() => (step = 1)}><ArrowLeft size={16} /> Back</Button>
			{/if}
		{/if}
	{/snippet}
</Dialog>
