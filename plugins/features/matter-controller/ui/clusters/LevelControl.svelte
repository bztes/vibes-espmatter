<!-- Level Control cluster (0x0008): brightness slider. -->
<script lang="ts">
	import Range from './Range.svelte';
	import { ACTIONS, send } from '../actions';
	import type { ClusterProps } from './types';

	let { node, ep, disabled = false, run }: ClusterProps = $props();

	// Matter 1–254 ⇄ 1–100 %.
	const percent = $derived(ep.level == null ? 0 : Math.round((ep.level / 254) * 100));

	const setLevel = (p: number) => run(() => send(node, ep.id, ACTIONS.level.op(p)));
</script>

<Range
	label="Brightness"
	min={1}
	value={percent}
	format={(v) => `${v} %`}
	{disabled}
	onchange={setLevel}
/>
