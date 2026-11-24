<!-- One reading of an endpoint as a tile; links to what plugins open for the value. -->
<script lang="ts">
	import { Stat, ValueLink } from '#sdk/device-ui';
	import { valueRef, type Reading } from './clusters';
	import type { Endpoint } from './matter';

	let { node, ep, reading: r }: { node: number; ep: Endpoint; reading: Reading } = $props();

	const label = $derived(r.label(ep));
</script>

<ValueLink
	ref={valueRef(node, ep, r.metric, label)}
	class="min-w-0 rounded-xl bg-surface-2 px-3 py-2"
>
	<Stat {label} value={r.value(ep)} unit={r.unit} tone={r.tone?.(ep)} />
</ValueLink>
