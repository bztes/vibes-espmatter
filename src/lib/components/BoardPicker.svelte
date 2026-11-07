<!-- Choose the board of a slot. Boards that miss what the slot needs are listed, but marked. -->
<script lang="ts">
	import { CHIPS, type BoardDef, type HardwareRequirements } from '#sdk';
	import { boards } from '#lib/core/registry.ts';
	import { requirementIssues } from '#lib/core/validate.ts';
	import { Select } from '#lib/ui/index.ts';

	let {
		value,
		requires,
		id,
		onchange
	}: {
		value: string;
		requires?: HardwareRequirements;
		id?: string;
		onchange: (id: string) => void;
	} = $props();

	const groups = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const byChip = new Map<string, BoardDef[]>();
		for (const b of boards.all()) byChip.set(b.chip, [...(byChip.get(b.chip) ?? []), b]);
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
	const unfit = (b: BoardDef) =>
		requirementIssues(b, requires, 'x').length > 0 || !!CHIPS[b.chip].matterUnsupported;
</script>

<Select {id} {value} onchange={(e) => onchange(e.currentTarget.value)}>
	{#each groups as g (g.chip.id)}
		<optgroup label="{g.chip.name} – {capsOf(g.chip)}">
			{#each g.list as b (b.id)}
				<option value={b.id}>{b.name}{unfit(b) ? ' (not suitable)' : ''}</option>
			{/each}
		</optgroup>
	{/each}
</Select>
