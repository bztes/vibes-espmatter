<!-- Thermostat cluster (0x0201): room temperature, setpoint, system mode. -->
<script lang="ts">
	import { Button, Segmented, Stat } from '#sdk/device-ui';
	import { ACTIONS, send } from '../actions';
	import { CLUSTER, SYSTEM_MODES, hasCluster, systemModes } from '../matter';
	import type { ClusterProps } from './types';

	let { node, ep, disabled = false, run }: ClusterProps = $props();

	const modes = $derived.by(() => {
		const offered = systemModes(ep);
		return [
			// with an On/Off cluster, power is its toggle
			...(hasCluster(ep, CLUSTER.onOff) ? [] : [0]),
			...offered,
			...(ep.systemMode != null && ep.systemMode !== 0 && !offered.includes(ep.systemMode)
				? [ep.systemMode]
				: [])
		];
	});

	/** The setpoint that applies to the current mode. */
	const setpoint = $derived.by(() => {
		const cooling = ep.coolingSetpoint != null;
		const heating = ep.heatingSetpoint != null;
		if (cooling && (ep.systemMode === 3 || !heating)) return 'coolingSetpoint' as const;
		if (heating) return 'heatingSetpoint' as const;
		return undefined;
	});
	const target = $derived(setpoint ? ep[setpoint] : undefined);

	const step = (delta: number) => {
		if (!setpoint || target == null) return;
		const next = Math.min(32, Math.max(7, Math.round((target + delta) * 2) / 2));
		run(() => send(node, ep.id, ACTIONS[setpoint].op(next)));
	};
</script>

{#if setpoint && target != null}
	<div class="flex items-center justify-between gap-3 py-1">
		<Button
			class="size-11 shrink-0 rounded-full text-xl"
			size="icon"
			aria-label="Colder"
			{disabled}
			onclick={() => step(-0.5)}>−</Button
		>
		<div class="min-w-0 text-center">
			<div class="text-xs text-muted">
				{setpoint === 'coolingSetpoint' ? 'Cool to' : 'Heat to'}
			</div>
			<div class="text-4xl font-semibold tracking-tight tabular-nums">
				{target.toFixed(1)}<span class="text-2xl font-normal text-muted">°</span>
			</div>
			{#if ep.outdoorTemperature != null}
				<div class="text-xs text-muted">Outside {ep.outdoorTemperature.toFixed(1)} °C</div>
			{/if}
		</div>
		<Button
			class="size-11 shrink-0 rounded-full text-xl"
			size="icon"
			aria-label="Warmer"
			{disabled}
			onclick={() => step(0.5)}>+</Button
		>
	</div>
{:else}
	<div class="flex flex-wrap gap-x-6 gap-y-2">
		<Stat label="Room" value={ep.localTemperature?.toFixed(1)} unit="°C" />
		{#if ep.outdoorTemperature != null}
			<Stat label="Outside" value={ep.outdoorTemperature.toFixed(1)} unit="°C" />
		{/if}
	</div>
{/if}
{#if ep.systemMode !== undefined && modes.length > 1}
	<div class="grid gap-1.5">
		<span class="text-sm text-muted">Mode</span>
		<Segmented
			label="Mode"
			options={modes.map((m) => ({ value: String(m), label: SYSTEM_MODES[m] ?? `Mode ${m}` }))}
			value={ep.systemMode == null ? undefined : String(ep.systemMode)}
			{disabled}
			onchange={(m) => run(() => send(node, ep.id, ACTIONS.systemMode.op(Number(m))))}
		/>
	</div>
{/if}
