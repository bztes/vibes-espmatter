<!--
	Timers on the dashboard (espm_timers.cpp). Everyone sees and edits the timers of the lights
	they may control – the device filters the list. Admins set the time zone (click the clock).
-->
<script lang="ts">
	import AlarmClock from '@lucide/svelte/icons/alarm-clock';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Play from '@lucide/svelte/icons/play';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { api, errorMessage } from '../../web-ui/device-ui/api';
	import { auth } from '../../web-ui/device-ui/auth.svelte';
	import { live } from '../../web-ui/device-ui/live.svelte';
	import Menu from '../../../device-ui/Menu.svelte';
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import { Alert, Badge, Button, Select, showConfirm, Switch } from '../../../device-ui/ui';
	import { LIGHT_TYPES, endpointName, matterNodes } from '../../matter-controller/device-ui/matter';
	import TimerDialog from './TimerDialog.svelte';
	import {
		daysLabel,
		describe,
		fmtMinute,
		inWords,
		isOnce,
		minutesUntil,
		type LightChoice,
		type Timer,
		type TimersResponse
	} from './timers';
	import { TIME_ZONES } from './timezones';

	const timers = live<TimersResponse>('/api/timers', 30_000);
	const nodes = matterNodes();

	const lights = $derived<LightChoice[]>(
		(nodes.data?.nodes ?? []).flatMap((node) =>
			node.endpoints
				.filter((ep) => LIGHT_TYPES.includes(ep.deviceType))
				.map((endpoint) => ({
					key: `${node.id}:${endpoint.id}`,
					node: node.id,
					name: endpointName(node, endpoint, 'light'),
					endpoint
				}))
		)
	);
	const lightName = (t: Timer) =>
		lights.find((l) => l.key === `${t.node}:${t.endpoint}`)?.name ?? 'Unknown light';
	// One-shot timers first, soonest first; then the recurring ones by time of day.
	const sorted = $derived(
		[...(timers.data?.timers ?? [])].sort((a, b) =>
			isOnce(a) !== isOnce(b)
				? Number(isOnce(b)) - Number(isOnce(a))
				: isOnce(a)
					? (a.remaining ?? 0) - (b.remaining ?? 0)
					: a.minute - b.minute
		)
	);
	const clock = $derived(timers.data?.clock);
	const next = $derived.by(() => {
		if (clock?.minute === undefined || clock.weekday === undefined) return undefined;
		const now = { minute: clock.minute, weekday: clock.weekday };
		let best: { timer: Timer; in: number } | undefined;
		for (const t of sorted) {
			const until = minutesUntil(t, now);
			if (until !== undefined && (!best || until < best.in)) best = { timer: t, in: until };
		}
		return best;
	});

	let dialog = $state<TimerDialog>();
	let error = $state('');

	async function call(body: Record<string, string | number | boolean | undefined>) {
		error = '';
		try {
			await api('/api/timers', { body });
			await timers.refresh();
			return true;
		} catch (e) {
			error = errorMessage(e);
			return false;
		}
	}

	const isAdmin = $derived(auth.session?.role === 'admin');
	/** The zone being picked; `undefined` while the picker is closed. */
	let zone = $state<string>();

	function editZone() {
		const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
		zone = clock?.tz || (browser in TIME_ZONES ? browser : 'UTC');
	}

	async function saveZone(ev: SubmitEvent) {
		ev.preventDefault();
		if (zone && (await call({ op: 'timezone', name: zone, rule: TIME_ZONES[zone] }))) {
			zone = undefined;
		}
	}

	async function remove(t: Timer) {
		const what = isOnce(t) ? 'Cancel' : 'Delete';
		const ok = await showConfirm(
			`${what} timer`,
			`${what} the ${fmtMinute(t.minute)} timer of ${lightName(t)}?`,
			{
				action: what,
				danger: true
			}
		);
		if (ok) {
			call({ op: 'delete', id: t.id });
		}
	}
</script>

<Panel title="Timers">
	{#snippet badge()}
		<span class="flex items-center gap-2 font-normal">
			{#if clock && !clock.synced}
				<Badge tone="warn" title="The device gets the time from the internet (NTP)"
					>Clock not set yet</Badge
				>
			{:else if clock?.minute !== undefined}
				{@const title = `Device time (${clock.tz || 'UTC, no time zone set'})`}
				{#if isAdmin}
					<Badge title="{title} – change the time zone" onclick={editZone}>
						<AlarmClock size={13} />
						{fmtMinute(clock.minute)}
					</Badge>
				{:else}
					<Badge {title}><AlarmClock size={13} /> {fmtMinute(clock.minute)}</Badge>
				{/if}
			{/if}
			{#if isAdmin && clock && !clock.tz && zone === undefined}
				<Badge tone="warn" onclick={editZone}>Set time zone</Badge>
			{/if}
			{#if lights.length && timers.data && timers.data.count < timers.data.max}
				<Button onclick={() => dialog?.open()}><Plus size={15} /> New timer</Button>
			{/if}
		</span>
	{/snippet}

	{#if zone !== undefined}
		<form
			class="mb-3 flex flex-wrap items-end gap-2 [&_label]:m-0 [&_label]:min-w-[180px] [&_label]:flex-1"
			onsubmit={saveZone}
		>
			<Select label="Time zone of the timers" bind:value={zone}>
				{#each Object.keys(TIME_ZONES) as tz (tz)}
					<option value={tz}>{tz.replaceAll('_', ' ')}</option>
				{/each}
			</Select>
			<Button type="submit" variant="primary">Save</Button>
			<Button onclick={() => (zone = undefined)}>Cancel</Button>
		</form>
	{/if}

	{#if !timers.data}
		<p class="text-muted">{timers.error ?? 'Loading…'}</p>
	{:else if sorted.length === 0}
		<p class="text-muted">
			{lights.length ? 'No timers yet.' : 'No lights you could set a timer for.'}
		</p>
	{:else}
		{#if next}
			<p class="mt-0 mb-2 text-sm text-muted">
				Next: {fmtMinute(next.timer.minute)}
				{lightName(next.timer)} ({inWords(next.in)})
			</p>
		{/if}
		<ul class="m-0 list-none p-0">
			{#each sorted as t (t.id)}
				<li class="flex items-center gap-3.5 border-t py-2.5">
					<span class={['min-w-16 text-xl font-semibold tabular-nums', !t.enabled && 'opacity-45']}
						>{fmtMinute(t.minute)}</span
					>
					<div class={['grid min-w-0 flex-1 text-sm', !t.enabled && 'opacity-45']}>
						<strong>{t.name || lightName(t)}</strong>
						<span class="text-muted">
							{t.name ? `${lightName(t)} · ` : ''}{daysLabel(t.days)}{isOnce(t)
								? ` · ${inWords(Math.ceil((t.remaining ?? 0) / 60))}`
								: ''}
						</span>
						<span class="text-muted">{describe(t)}</span>
					</div>
					{#if isOnce(t)}
						<!-- Runs once, then it's gone: cancel it with Delete. -->
						<span class="w-9 shrink-0"></span>
					{:else}
						<Switch
							checked={t.enabled}
							title={t.enabled ? 'Enabled' : 'Disabled'}
							aria-label="Enabled"
							onchange={(e) => call({ op: 'set', id: t.id, enabled: e.currentTarget.checked })}
						/>
					{/if}
					<Menu
						label="Actions for this timer"
						icon
						items={[
							{ label: 'Edit', icon: Pencil, onclick: () => dialog?.open(t) },
							{ label: 'Run now', icon: Play, onclick: () => call({ op: 'run', id: t.id }) },
							{
								label: isOnce(t) ? 'Cancel timer' : 'Delete',
								icon: Trash2,
								danger: true,
								onclick: () => remove(t)
							}
						]}
					>
						{#snippet trigger()}<EllipsisVertical size={16} />{/snippet}
					</Menu>
				</li>
			{/each}
		</ul>
	{/if}
	{#if error}<Alert>{error}</Alert>{/if}
</Panel>

<TimerDialog bind:this={dialog} {lights} onsaved={timers.refresh} />
