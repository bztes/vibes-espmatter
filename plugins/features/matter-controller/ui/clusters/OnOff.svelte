<!-- On/Off cluster (0x0006): power toggle. -->
<script lang="ts">
	import { Toggle } from '#sdk/device-ui';
	import { ACTIONS, send } from '../actions';
	import type { ClusterProps } from './types';

	let { node, ep, disabled = false, run }: ClusterProps = $props();
</script>

<div class="flex items-center justify-between gap-3">
	<span class="text-sm font-medium">{ep.on == null ? '–' : ep.on ? 'On' : 'Off'}</span>
	<Toggle
		label="Power"
		checked={ep.on ?? false}
		{disabled}
		onchange={(on) => run(() => send(node, ep.id, ACTIONS[on ? 'on' : 'off'].op()))}
	/>
</div>
