<!-- Fan Control cluster (0x0202): fan mode. -->
<script lang="ts">
	import { Segmented } from '#sdk/device-ui';
	import { ACTIONS, send } from '../actions';
	import { FAN_MODES } from '../matter';
	import type { ClusterProps } from './types';

	let { node, ep, disabled = false, run }: ClusterProps = $props();
</script>

<div class="grid gap-1.5">
	<span class="text-sm text-muted">Fan</span>
	<Segmented
		label="Fan"
		options={FAN_MODES}
		value={ep.fanMode == null ? undefined : String(ep.fanMode)}
		{disabled}
		onchange={(m) => run(() => send(node, ep.id, ACTIONS.fanMode.op(Number(m))))}
	/>
</div>
