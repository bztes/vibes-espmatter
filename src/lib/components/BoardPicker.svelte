<!-- Choose the board of a slot: only boards that run everything enabled (the current one stays, marked). -->
<script lang="ts">
	import { CHIPS, type BoardDef } from '#sdk';
	import { boards } from '#lib/core/registry.ts';
	import { Select } from '#lib/ui/index.ts';

	let {
		value,
		fitting,
		id,
		onchange
	}: {
		value: string;
		/** Boards that fit, in catalog order. */
		fitting: BoardDef[];
		id?: string;
		onchange: (id: string) => void;
	} = $props();

	const fits = $derived(fitting.some((b) => b.id === value));
	const groups = $derived.by(() => {
		const list = fits ? fitting : boards.all().filter((b) => b.id === value || fitting.includes(b));
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const byChip = new Map<string, BoardDef[]>();
		for (const b of list) byChip.set(b.chip, [...(byChip.get(b.chip) ?? []), b]);
		return [...byChip.entries()].map(([chip, list]) => ({
			chip: CHIPS[chip as keyof typeof CHIPS],
			list
		}));
	});
	const CAP: Record<string, string> = {
		wifi: 'Wi-Fi',
		ble: 'BLE',
		ieee802154: 'Thread',
		'ethernet-mac': 'Ethernet'
	};
	const capsOf = (chip: (typeof CHIPS)[keyof typeof CHIPS]) =>
		chip.capabilities.flatMap((c) => (CAP[c] ? [CAP[c]] : [])).join(' · ');
</script>

<Select {id} {value} onchange={(e) => onchange(e.currentTarget.value)}>
	{#each groups as g (g.chip.id)}
		<optgroup label="{g.chip.name} – {capsOf(g.chip)}">
			{#each g.list as b (b.id)}
				<option value={b.id}>{b.name}{b.id === value && !fits ? ' (doesn’t fit)' : ''}</option>
			{/each}
		</optgroup>
	{/each}
</Select>
