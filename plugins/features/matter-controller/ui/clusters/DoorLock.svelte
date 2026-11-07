<!-- Door Lock cluster (0x0101): state and lock/unlock. -->
<script lang="ts">
	import { Button } from '#sdk/device-ui';
	import { ACTIONS, send } from '../actions';
	import type { ClusterProps } from './types';

	let { node, ep, disabled = false, run }: ClusterProps = $props();

	const STATES = ['Not fully locked', 'Locked', 'Unlocked', 'Unlatched'];
	const locked = $derived(ep.lockState === 1);
</script>

<div class="flex items-center justify-between gap-3">
	<span class="text-sm font-medium"
		>{ep.lockState == null ? 'Unknown' : (STATES[ep.lockState] ?? 'Unknown')}</span
	>
	<Button
		class="rounded-full"
		variant={locked ? 'secondary' : 'primary'}
		{disabled}
		onclick={() => run(() => send(node, ep.id, ACTIONS[locked ? 'unlock' : 'lock'].op()))}
		>{locked ? 'Unlock' : 'Lock'}</Button
	>
</div>
