<!--
	One climate device: room temperature, target temperature, mode, fan and swing –
	what the device has of them. A user who may only view it gets the same tile with the controls
	disabled.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { api, errorMessage, hexId } from '../../web-ui/device-ui/api';
	import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';
	import Fan from '@lucide/svelte/icons/fan';
	import { Select } from '../../../device-ui/ui';
	import {
		FAN_MODE,
		ROOM_AIR_CONDITIONER,
		SYSTEM_MODE,
		THERMOSTAT_AUTO,
		THERMOSTAT_COOLING,
		THERMOSTAT_HEATING,
		type MatterEndpoint
	} from './matter';

	let {
		nodeId,
		name,
		endpoint,
		reachable,
		onupdate
	}: {
		nodeId: number;
		name: string;
		endpoint: MatterEndpoint;
		reachable: boolean;
		onupdate: () => Promise<void>;
	} = $props();

	const CLUSTER_ON_OFF = 0x0006;
	const CLUSTER_THERMOSTAT = 0x0201;
	const CLUSTER_FAN = 0x0202;
	const ATTR_HEATING = 0x0012;
	const ATTR_COOLING = 0x0011;
	const ATTR_SYSTEM_MODE = 0x001c;
	const ATTR_FAN_MODE = 0x0000;
	const ATTR_ROCK = 0x000a;
	/** 0.5 °C, in 0.01 °C. */
	const STEP = 50;
	/** Clicks within this time are sent as one change. */
	const SEND_DELAY_MS = 800;
	/** Matter's defaults for unreported limits. */
	const HEATING = { min: 700, max: 3000 };
	const COOLING = { min: 1600, max: 3200 };
	/** FanModeSequence → fan modes besides off. */
	const FAN_SEQUENCES: (keyof typeof FAN_MODE)[][] = [
		['low', 'medium', 'high'],
		['low', 'high'],
		['auto', 'low', 'medium', 'high'],
		['auto', 'low', 'high'],
		['auto', 'high'],
		['high']
	];
	const FAN_LABELS = { off: 'Off', low: 'Low', medium: 'Med', high: 'High', auto: 'Auto' };
	const MODE_LABELS: Record<keyof typeof SYSTEM_MODE, string> = {
		off: 'Off',
		auto: 'Auto',
		heat: 'Heat',
		cool: 'Cool',
		dry: 'Dry',
		fan: 'Fan'
	};

	const climate = $derived(endpoint.climate ?? { features: 0 });
	const readOnly = $derived(endpoint.readOnly ?? false);
	const airConditioner = $derived(endpoint.deviceType === ROOM_AIR_CONDITIONER);
	/** Air conditioners switch with On/Off, thermostats with their mode “Off”. */
	const hasPower = $derived(airConditioner || endpoint.on !== undefined);

	// Optimistic state: shown right away, replaced by what the device reports.
	let pending = $state<{
		on?: boolean;
		mode?: number;
		heating?: number;
		cooling?: number;
		fanMode?: number;
		rock?: number;
	}>({});
	let error = $state('');

	const mode = $derived(pending.mode ?? climate.mode);
	const on = $derived(
		pending.on ?? (hasPower ? (endpoint.on ?? false) : mode !== undefined && mode !== 0)
	);
	const heating = $derived(pending.heating ?? climate.heating);
	const cooling = $derived(pending.cooling ?? climate.cooling);
	const fanMode = $derived(pending.fanMode ?? climate.fanMode);
	const rock = $derived(pending.rock ?? climate.rock);

	/** From the Thermostat FeatureMap; heat and cool if unknown. */
	const modes = $derived.by(() => {
		const f = climate.features || THERMOSTAT_HEATING | THERMOSTAT_COOLING;
		return (Object.keys(SYSTEM_MODE) as (keyof typeof SYSTEM_MODE)[]).filter((m) => {
			if (m === 'off') return !hasPower;
			if (m === 'auto') return f & THERMOSTAT_AUTO;
			if (m === 'heat') return f & THERMOSTAT_HEATING;
			if (m === 'cool') return f & THERMOSTAT_COOLING;
			return airConditioner; // dry, fan
		});
	});
	const fanModes = $derived(
		climate.fanMode === undefined ? [] : (FAN_SEQUENCES[climate.fanSequence ?? 0] ?? [])
	);

	/** Heating or cooling setpoint; in auto both together. */
	const target = $derived.by(() => {
		if (!on) return undefined;
		if (mode === SYSTEM_MODE.heat && heating !== undefined) return heating;
		if ((mode === SYSTEM_MODE.cool || mode === SYSTEM_MODE.dry) && cooling !== undefined)
			return cooling;
		if (mode === SYSTEM_MODE.auto && heating !== undefined && cooling !== undefined)
			return Math.round((heating + cooling) / 2);
		return undefined;
	});

	const fmt = (centi: number) =>
		(centi / 100).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
	const modeName = (m?: number) =>
		Object.entries(SYSTEM_MODE).find(([, v]) => v === m)?.[0] as
			keyof typeof SYSTEM_MODE | undefined;
	const status = $derived.by(() => {
		if (!on) return 'Off';
		const label = MODE_LABELS[modeName(mode) ?? 'auto'];
		return target === undefined ? label : `${label} · ${fmt(target)} °C`;
	});

	const glow = $derived.by(() => {
		if (!on) return 'transparent';
		if (mode === SYSTEM_MODE.heat) return 'rgba(255,140,60,0.4)';
		if (mode === SYSTEM_MODE.cool) return 'rgba(80,160,255,0.4)';
		return 'rgba(120,200,190,0.3)';
	});

	async function send(body: Record<string, string | number>) {
		error = '';
		await api('/api/matter/node', {
			body: { id: hexId(nodeId), endpoint: endpoint.id, ...body }
		});
	}

	const write = (cluster: number, attribute: number, value: string) =>
		send({ action: 'write', cluster, attribute, value });

	/** Send, then show what the device reports. */
	async function change(update: typeof pending, ...requests: (() => Promise<unknown>)[]) {
		pending = { ...pending, ...update };
		try {
			for (const request of requests) await request();
			setTimeout(async () => {
				await onupdate();
				pending = {};
			}, 1500);
		} catch (e) {
			pending = {};
			error = errorMessage(e);
		}
	}

	function togglePower() {
		change({ on: !on }, () => send({ action: 'invoke', cluster: CLUSTER_ON_OFF, command: 0x02 }));
	}

	function setMode(m: number) {
		change({ mode: m, ...(hasPower && m !== 0 ? { on: true } : {}) }, () =>
			write(CLUSTER_THERMOSTAT, ATTR_SYSTEM_MODE, JSON.stringify({ '0:U8': m }))
		);
	}

	const fanLabel = $derived(FAN_LABELS[fanModes.find((m) => FAN_MODE[m] === fanMode) ?? 'auto']);

	/** One button cycles through the speeds, like the remote. */
	function nextFan() {
		const i = fanModes.findIndex((m) => FAN_MODE[m] === fanMode);
		const m = FAN_MODE[fanModes[(i + 1) % fanModes.length]];
		change({ fanMode: m }, () => write(CLUSTER_FAN, ATTR_FAN_MODE, JSON.stringify({ '0:U8': m })));
	}

	function toggleRock() {
		const value = rock ? 0 : (climate.rockSupport ?? 0);
		change({ rock: value }, () => write(CLUSTER_FAN, ATTR_ROCK, JSON.stringify({ '0:U8': value })));
	}

	const clamp = (v: number, min = -Infinity, max = Infinity) => Math.min(max, Math.max(min, v));
	const setpoint = (attribute: number, value: number) => () =>
		write(CLUSTER_THERMOSTAT, attribute, JSON.stringify({ '0:I16': value }));

	let sendTimer: ReturnType<typeof setTimeout> | undefined;

	/** Shown right away; sent once the clicks stop. */
	function step(delta: number) {
		const heat = (v: number) =>
			clamp(v, climate.heatingMin ?? HEATING.min, climate.heatingMax ?? HEATING.max);
		const cool = (v: number) =>
			clamp(v, climate.coolingMin ?? COOLING.min, climate.coolingMax ?? COOLING.max);
		if (mode === SYSTEM_MODE.heat && heating !== undefined) {
			pending.heating = heat(heating + delta);
		} else if (mode === SYSTEM_MODE.auto && heating !== undefined && cooling !== undefined) {
			pending.heating = heat(heating + delta);
			pending.cooling = cool(cooling + delta);
		} else if (cooling !== undefined) {
			pending.cooling = cool(cooling + delta);
		}
		clearTimeout(sendTimer);
		sendTimer = setTimeout(() => {
			const requests = [];
			if (pending.heating !== undefined) requests.push(setpoint(ATTR_HEATING, pending.heating));
			if (pending.cooling !== undefined) requests.push(setpoint(ATTR_COOLING, pending.cooling));
			// In auto: the one moving away first, to keep the deadband.
			if (delta > 0) requests.reverse();
			change({}, ...requests);
		}, SEND_DELAY_MS);
	}

	onDestroy(() => clearTimeout(sendTimer));
</script>

{#snippet stepButton(delta: number)}
	<button
		class="grid size-7 cursor-pointer place-items-center rounded-full border bg-bg p-0 disabled:cursor-default disabled:opacity-50"
		onclick={() => step(delta)}
		disabled={readOnly}
		aria-label="{delta < 0 ? 'Lower' : 'Raise'} the target temperature"
		>{delta < 0 ? '−' : '+'}</button
	>
{/snippet}

<article
	class="relative grid content-start gap-2.5 rounded-[14px] border px-4 py-3.5 transition-[background] duration-400 [background:linear-gradient(135deg,var(--glow),transparent_75%),var(--color-card)]"
	style:--glow={glow}
>
	<div class="flex items-center gap-3">
		<div class="grid min-w-0 flex-1">
			<strong class="truncate">{name}</strong>
			<span class="text-xs text-muted">
				{#if !reachable}<span class="text-warn">not reachable</span>{:else}{status}{/if}
				{#if readOnly}· view only{/if}
			</span>
		</div>
		{#if hasPower}
			<button
				class={[
					'grid size-[46px] cursor-pointer place-items-center rounded-full border p-0 disabled:cursor-default',
					on ? 'border-[#f6b44c] bg-[#f6b44c] text-[#3b2600]' : 'bg-bg text-muted'
				]}
				onclick={togglePower}
				disabled={readOnly}
				aria-pressed={on}
				title={readOnly ? 'View only' : on ? 'Turn off' : 'Turn on'}
				aria-label="{on ? 'Turn off' : 'Turn on'} {name}"
			>
				<svg
					width="22"
					height="22"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.4"
				>
					<path d="M12 3v9" stroke-linecap="round" />
					<path d="M6.3 6.8a8 8 0 1 0 11.4 0" stroke-linecap="round" />
				</svg>
			</button>
		{/if}
	</div>

	<div class="flex items-end justify-between gap-3">
		<div class="grid">
			<span class="text-[28px] leading-[1.1] font-semibold tabular-nums"
				>{climate.temperature === undefined ? '–' : fmt(climate.temperature)}<small
					class="ml-0.5 text-base font-medium text-muted">°C</small
				></span
			>
			<span class="text-xs text-muted"
				>Room{#if climate.outdoor !== undefined}
					· {fmt(climate.outdoor)} °C outside{/if}</span
			>
		</div>
		{#if target !== undefined}
			<div class="grid justify-items-center">
				<div class="flex items-center">
					{@render stepButton(-STEP)}
					<span class="min-w-[2.9em] text-center font-semibold tabular-nums">{fmt(target)}</span>
					{@render stepButton(STEP)}
				</div>
				<span class="text-xs text-muted">Target</span>
			</div>
		{/if}
	</div>

	{#if climate.mode !== undefined || fanModes.length || climate.rockSupport}
		<div class="flex items-center gap-1.5">
			{#if climate.mode !== undefined}
				<Select
					class="min-w-0 flex-1 text-sm"
					aria-label="Mode"
					value={String(on ? mode : 0)}
					disabled={readOnly}
					onchange={(e) => setMode(Number(e.currentTarget.value))}
				>
					{#if hasPower && !on}<option value="0" disabled>Off</option>{/if}
					{#each modes as m (m)}
						<option value={String(SYSTEM_MODE[m])}>{MODE_LABELS[m]}</option>
					{/each}
				</Select>
			{/if}
			{#if fanModes.length}
				<button
					class="inline-flex h-8.25 shrink-0 cursor-pointer items-center gap-1 rounded-lg border bg-bg px-2 text-sm disabled:cursor-default disabled:opacity-50"
					onclick={nextFan}
					disabled={readOnly}
					title="Fan – click for the next speed"
					aria-label="Fan: {fanLabel}"><Fan size={15} class="text-muted" />{fanLabel}</button
				>
			{/if}
			{#if climate.rockSupport}
				<button
					class={[
						'grid size-8.25 shrink-0 cursor-pointer place-items-center rounded-lg border p-0 disabled:cursor-default disabled:opacity-50',
						rock ? 'border-accent bg-accent text-white' : 'bg-bg text-muted'
					]}
					onclick={toggleRock}
					disabled={readOnly}
					aria-pressed={!!rock}
					title="Swing"
					aria-label="Swing"><ArrowUpDown size={16} /></button
				>
			{/if}
		</div>
	{/if}
	{#if error}<p class="m-0 text-sm text-err">{error}</p>{/if}
</article>
