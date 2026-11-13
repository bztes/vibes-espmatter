<script lang="ts">
	import BatteryLow from '@lucide/svelte/icons/battery-low';
	import Blinds from '@lucide/svelte/icons/blinds';
	import Cpu from '@lucide/svelte/icons/cpu';
	import DoorClosed from '@lucide/svelte/icons/door-closed';
	import Droplets from '@lucide/svelte/icons/droplets';
	import Fan from '@lucide/svelte/icons/fan';
	import Footprints from '@lucide/svelte/icons/footprints';
	import Gauge from '@lucide/svelte/icons/gauge';
	import Lightbulb from '@lucide/svelte/icons/lightbulb';
	import Lock from '@lucide/svelte/icons/lock';
	import Plug from '@lucide/svelte/icons/plug';
	import Thermometer from '@lucide/svelte/icons/thermometer';
	import ThermometerSun from '@lucide/svelte/icons/thermometer-sun';
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import type { Component } from 'svelte';
	import { Spot, Poll, Segmented, Stat, Stored, Toggle, errorText, session } from '#sdk/device-ui';
	import EndpointControls from './EndpointControls.svelte';
	import {
		controllableEndpoints,
		controlsOf,
		deviceKind,
		isActive,
		isAlert,
		readingsOf,
		summary,
		type DeviceKind
	} from './clusters';
	import { CLUSTER, allTags, invoke, typeName, type Endpoint, type Node } from './matter';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const ICONS: Record<DeviceKind, Component<any>> = {
		light: Lightbulb,
		plug: Plug,
		thermostat: ThermometerSun,
		fan: Fan,
		blinds: Blinds,
		lock: Lock,
		contact: DoorClosed,
		leak: Droplets,
		motion: Footprints,
		climate: Thermometer,
		sensor: Gauge,
		device: Cpu
	};

	const nodes = new Poll<{ nodes: Node[] }>('/api/v1/controller/nodes', 4000);
	let errors = $state<Record<number, string>>({});

	/** Grouped by tag: a device with several tags shows in each of their groups. Remembered per browser. */
	const GROUP_KEY = 'espm.dashboard.group';
	const grouping = new Stored(GROUP_KEY, 'all', (v) => v === 'tags');
	const GROUPINGS = [
		{ value: 'all', label: 'All' },
		{ value: 'tags', label: 'By tag' }
	];

	const all = $derived(nodes.current?.nodes ?? []);
	/** Only devices with something to switch, set or read; the rest live in the admin page. */
	const list = $derived(all.filter((n) => controllableEndpoints(n).length));
	const hidden = $derived(all.length - list.length);
	const tags = $derived(allTags(list));
	const groups = $derived.by(() => {
		if (grouping.value !== 'tags' || !tags.length) return [{ title: '', nodes: list }];
		const untagged = list.filter((n) => !n.tags?.length);
		return [
			...tags.map((t) => ({ title: t, nodes: list.filter((n) => n.tags?.includes(t)) })),
			...(untagged.length ? [{ title: 'No tag', nodes: untagged }] : [])
		];
	});

	const hasSwitch = (ep: Endpoint) => controlsOf(ep).some((c) => c.cluster === CLUSTER.onOff);

	const lowBattery = (n: Node) =>
		(n.battery != null && n.battery <= 20) ||
		n.batteryLevel === 'warning' ||
		n.batteryLevel === 'critical';

	/** Section names of a device with several endpoints: "Light", "Light 2" … */
	function labels(endpoints: Endpoint[]) {
		const seen: Record<string, number> = {};
		return endpoints.map((ep) => {
			const name = typeName(ep) || 'Channel';
			seen[name] = (seen[name] ?? 0) + 1;
			return seen[name] > 1 ? `${name} ${seen[name]}` : name;
		});
	}

	function status(node: Node, ctrl: Endpoint[], sensors: Endpoint[]) {
		if (node.state === 'offline') return 'Offline';
		if (node.state === 'connecting') return 'Connecting…';
		const switches = ctrl.filter((ep) => ep.on != null);
		if (switches.length > 1) {
			const on = switches.filter((ep) => ep.on).length;
			return on ? `${on} of ${switches.length} on` : 'All off';
		}
		if (ctrl.length) return summary(ctrl[0]) || typeName(ctrl[0]) || 'Ready';
		// Sensors only: what they are ("Temperature, Humidity"), the values are in the tiles.
		const kinds = sensors.flatMap((ep) => readingsOf(ep).map((r) => r.label(ep)));
		return [...new Set(kinds)].join(', ') || 'Sensor';
	}

	/** Send an action, then refresh once the subscription had time to report the change. */
	function runner(node: Node) {
		return async (action: () => Promise<unknown>) => {
			delete errors[node.id];
			try {
				await action();
				await new Promise((r) => setTimeout(r, 1200));
			} catch (e) {
				errors[node.id] = errorText(e);
			}
			await nodes.refresh();
		};
	}
</script>

{#snippet power(
	node: Node,
	ep: Endpoint,
	disabled: boolean,
	run: (a: () => Promise<unknown>) => void,
	label: string
)}
	<Toggle
		{label}
		checked={ep.on ?? false}
		{disabled}
		onchange={(on) => run(() => invoke(node.id, ep.id, CLUSTER.onOff, on ? 1 : 0))}
	/>
{/snippet}

{#snippet card(node: Node)}
	{@const endpoints = controllableEndpoints(node)}
	{@const run = runner(node)}
	{@const online = node.state === 'online'}
	{@const active = online && endpoints.some(isActive)}
	{@const alert = online && endpoints.some(isAlert)}
	{@const ctrl = endpoints.filter((ep) => controlsOf(ep).length)}
	{@const sensors = endpoints.filter((ep) => !controlsOf(ep).length)}
	{@const single = ctrl.length === 1 ? ctrl[0] : undefined}
	{@const Icon = ICONS[deviceKind(ctrl[0] ?? endpoints[0])]}
	<li
		class={[
			'flex min-w-0 flex-col gap-4 rounded-2xl border p-4 shadow-card transition-colors',
			active ? 'border-accent/25 bg-accent-soft/50' : 'border-border bg-surface',
			!online && 'opacity-70'
		]}
	>
		<div class="flex items-center gap-3">
			<div
				class={[
					'grid size-11 shrink-0 place-items-center rounded-full transition-colors',
					alert
						? 'bg-warn-soft text-warn'
						: active
							? 'bg-accent text-accent-fg'
							: 'bg-surface-2 text-muted'
				]}
			>
				<Icon size={22} strokeWidth={1.75} />
			</div>
			<div class="min-w-0 flex-1">
				<div class="truncate font-semibold">{node.name}</div>
				<div
					class={[
						'flex min-w-0 items-center gap-1 text-sm',
						node.state === 'offline' ? 'text-err' : alert ? 'text-warn' : 'text-muted'
					]}
				>
					{#if node.state === 'offline'}<WifiOff size={14} class="shrink-0" />{/if}
					<span class="truncate">{status(node, ctrl, sensors)}</span>
				</div>
			</div>
			<Spot name="device-icons" context={{ node: node.id, name: node.name }} />
			{#if lowBattery(node)}
				<span
					class={[
						'flex shrink-0 items-center gap-0.5 text-xs',
						node.batteryLevel === 'critical' || (node.battery ?? 100) <= 10
							? 'text-err'
							: 'text-warn'
					]}
					title="Battery low"
				>
					<BatteryLow size={18} class="shrink-0" />{#if node.battery != null}{node.battery} %{/if}
				</span>
			{/if}
			{#if single && hasSwitch(single)}
				{@render power(
					node,
					single,
					!online || single.access === 'read',
					run,
					`${node.name} power`
				)}
			{/if}
		</div>

		{#if single}
			<EndpointControls
				node={node.id}
				ep={single}
				disabled={!online || single.access === 'read'}
				{run}
				hide={[CLUSTER.onOff]}
			/>
		{:else}
			{@const names = labels(ctrl)}
			{#each ctrl as ep, i (ep.id)}
				{@const disabled = !online || ep.access === 'read'}
				<section class="grid min-w-0 gap-3 border-t border-border/70 pt-3" aria-label={names[i]}>
					<div class="flex items-center justify-between gap-3">
						<span class="min-w-0 truncate text-sm font-medium">{names[i]}</span>
						{#if hasSwitch(ep)}
							{@render power(node, ep, disabled, run, `${names[i]} power`)}
						{/if}
					</div>
					<EndpointControls node={node.id} {ep} {disabled} {run} hide={[CLUSTER.onOff]} />
				</section>
			{/each}
		{/if}

		{#if sensors.length}
			<!-- Readings of all sensor endpoints together: a climate sensor is one thing to people. -->
			<div class="grid grid-cols-2 gap-2">
				{#each sensors as ep (ep.id)}
					{#each readingsOf(ep) as r (r.cluster)}
						<div class="min-w-0 rounded-xl bg-surface-2 px-3 py-2">
							<Stat label={r.label(ep)} value={r.value(ep)} unit={r.unit} tone={r.tone?.(ep)} />
						</div>
					{/each}
				{/each}
			</div>
		{/if}

		{#if errors[node.id]}<p class="text-xs text-err">{errors[node.id]}</p>{/if}
	</li>
{/snippet}

{#if list.length}
	{#if tags.length}
		<div class="mb-3 flex items-center justify-end gap-2">
			<span class="text-xs text-muted">Group</span>
			<div class="w-40">
				<Segmented label="Group devices" bind:value={grouping.value} options={GROUPINGS} />
			</div>
		</div>
	{/if}
	<div class="grid gap-6">
		{#each groups as group (group.title)}
			<section class="grid gap-2" aria-label={group.title || 'Devices'}>
				{#if group.title}
					<h3 class="m-0 px-1 text-base font-semibold">
						{group.title} <span class="font-normal text-muted">· {group.nodes.length}</span>
					</h3>
				{/if}
				<ul
					class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] items-start gap-3"
				>
					{#each group.nodes as node (node.id)}
						{@render card(node)}
					{/each}
				</ul>
			</section>
		{/each}
	</div>
{:else if nodes.current}
	<p class="text-sm text-muted">
		{hidden
			? 'None of the devices has anything to control here.'
			: session.admin
				? 'No devices yet – pair one in the admin page.'
				: 'No devices shared with you yet – ask an admin of this hub.'}
	</p>
{:else if nodes.error}
	<p class="text-sm text-err">{nodes.error}</p>
{/if}
