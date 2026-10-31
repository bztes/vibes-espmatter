<!-- User dashboard: tiles for lights, plugs and temperature/humidity sensors (switches are left out), by name – optionally grouped by type or by the tags an admin gave them. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { api, hexId } from '../../web-ui/device-ui/api';
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import { Segmented } from '../../../device-ui/ui';
	import {
		SWITCHABLE_TYPES,
		PLUG_TYPES,
		SENSOR_TYPES,
		endpointName,
		matterNodes,
		nodeName,
		type MatterNode
	} from './matter';
	import SwitchableTile from './SwitchableTile.svelte';
	import SensorTile from './SensorTile.svelte';

	/**
	 * On/off, brightness and color temperature are only read on demand – refresh them now and then
	 * for changes made elsewhere.
	 */
	const STATE_REFRESH_MS = 30_000;
	/** An endpoint that didn't answer for this long is shown as not reachable. */
	const STALE_S = 15 * 60;
	const GROUPINGS = [
		['none', 'All'],
		['type', 'Type'],
		['tag', 'Tag']
	] as const;
	type Grouping = (typeof GROUPINGS)[number][0];
	const TYPES = { light: 'Lights', plug: 'Plugs', sensor: 'Sensors' } as const;
	const GROUPING_KEY = 'dashboard.grouping';
	const UNTAGGED = 'Untagged';

	/** Remembered per browser; storage may be unavailable (private mode). */
	let grouping = $state<Grouping>(
		(() => {
			try {
				const saved = localStorage.getItem(GROUPING_KEY);
				return GROUPINGS.some(([id]) => id === saved) ? (saved as Grouping) : 'none';
			} catch {
				return 'none';
			}
		})()
	);
	$effect(() => {
		try {
			localStorage.setItem(GROUPING_KEY, grouping);
		} catch {
			// not remembered
		}
	});

	const nodes = matterNodes();
	const tiles = $derived(
		(nodes.data?.nodes ?? []).flatMap((node) =>
			node.endpoints
				.filter((ep) => SWITCHABLE_TYPES.includes(ep.deviceType))
				.map((ep, _, switchable) => ({
					node,
					ep,
					key: `${node.id}:${ep.id}`,
					name: endpointName(node, ep, 'light'),
					type: PLUG_TYPES.includes(ep.deviceType) ? ('plug' as const) : ('light' as const),
					// Measured on the plug's own endpoint, or on a separate one of a single plug.
					power:
						node.power && (node.power.endpoint === ep.id || switchable.length === 1)
							? node.power.mw
							: undefined
				}))
		)
	);
	/**
	 * One tile per sensor device: temperature and humidity often sit on separate endpoints. The hub
	 * subscribes to them – no reading on demand, they are mostly sleepy battery devices.
	 */
	const sensors = $derived(
		(nodes.data?.nodes ?? []).flatMap((node) => {
			const eps = node.endpoints.filter((ep) => SENSOR_TYPES.includes(ep.deviceType));
			if (eps.length === 0) return [];
			const ages = eps.flatMap((ep) => ep.measuredAge ?? []);
			return [
				{
					node,
					key: `${node.id}`,
					name: nodeName(node),
					type: 'sensor' as const,
					temperature: eps.find((ep) => ep.temperature !== undefined)?.temperature,
					humidity: eps.find((ep) => ep.humidity !== undefined)?.humidity,
					age: ages.length ? Math.min(...ages) : undefined
				}
			];
		})
	);

	type Item =
		| ({ kind: 'switchable' } & (typeof tiles)[number])
		| ({ kind: 'sensor' } & (typeof sensors)[number]);
	const byName = (a: string, b: string) =>
		a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
	const items = $derived<Item[]>(
		[
			...tiles.map((t) => ({ kind: 'switchable' as const, ...t })),
			...sensors.map((s) => ({ kind: 'sensor' as const, ...s }))
		].sort((a, b) => byName(a.name, b.name))
	);
	/** Sections to show: one without a title when not grouped; by tag a device shows under each of its tags. */
	const groups = $derived.by(() => {
		if (grouping === 'none') return [{ title: '', items }];
		if (grouping === 'type')
			return Object.entries(TYPES)
				.map(([type, title]) => ({ title, items: items.filter((i) => i.type === type) }))
				.filter((g) => g.items.length);
		const tagsOf = (node: MatterNode) => (node.tags.length ? node.tags : [UNTAGGED]);
		const tags = [...new Set(items.flatMap((i) => tagsOf(i.node)))].sort((a, b) =>
			a === UNTAGGED ? 1 : b === UNTAGGED ? -1 : byName(a, b)
		);
		return tags.map((title) => ({
			title,
			items: items.filter((i) => tagsOf(i.node).includes(title))
		}));
	});

	async function readStates() {
		const ids = [...new Set(tiles.map((t) => t.node.id))];
		await Promise.all(
			ids.map((id) =>
				api('/api/matter/node', { body: { id: hexId(id), action: 'state' } }).catch(() => {})
			)
		);
		setTimeout(() => nodes.refresh(), 1500);
	}

	onMount(() => {
		// Wait for the node list, then read all lights and plugs once and every 30 s.
		const first = setTimeout(readStates, 800);
		const timer = setInterval(
			() => document.visibilityState === 'visible' && readStates(),
			STATE_REFRESH_MS
		);
		return () => {
			clearTimeout(first);
			clearInterval(timer);
		};
	});
</script>

<Panel title="Dashboard">
	{#snippet badge()}
		{#if items.length}<Segmented label="Group by" options={GROUPINGS} bind:value={grouping} />{/if}
	{/snippet}

	{#if !nodes.data}
		<p class="text-muted">{nodes.error ?? 'Loading…'}</p>
	{:else if tiles.length === 0 && sensors.length === 0}
		<p class="text-muted">No lights, plugs or sensors yet.</p>
	{:else}
		<div class="grid gap-5">
			{#each groups as group (group.title)}
				<section class="grid gap-2">
					{#if group.title}<h3 class="text-sm text-muted">{group.title}</h3>{/if}
					<div class="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
						{#each group.items as item (item.key)}
							{#if item.kind === 'switchable'}
								<SwitchableTile
									nodeId={item.node.id}
									name={item.name}
									endpoint={item.ep}
									power={item.power}
									reachable={item.node.lastSeen === null || item.node.lastSeen < STALE_S}
									onupdate={nodes.refresh}
								/>
							{:else}
								<SensorTile
									name={item.name}
									temperature={item.temperature}
									humidity={item.humidity}
									age={item.age}
									battery={item.node.battery}
								/>
							{/if}
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}
</Panel>
