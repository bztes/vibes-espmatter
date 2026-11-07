<!-- Window Covering cluster (0x0102): position slider, open/stop/close. -->
<script lang="ts">
	import { Button } from '#sdk/device-ui';
	import Range from './Range.svelte';
	import { ACTIONS, send, type ActionId } from '../actions';
	import type { ClusterProps } from './types';

	let { node, ep, disabled = false, run }: ClusterProps = $props();

	const cover = (id: ActionId, value = 0) => run(() => send(node, ep.id, ACTIONS[id].op(value)));
</script>

<Range
	label="Open"
	value={100 - Math.round(ep.closedPercent ?? 0)}
	format={(v) => `${v} %`}
	{disabled}
	onchange={(p) => cover('position', p)}
/>
<div class="grid grid-cols-3 gap-2">
	<Button class="rounded-full" {disabled} onclick={() => cover('open')}>Open</Button>
	<Button class="rounded-full" {disabled} onclick={() => cover('stop')}>Stop</Button>
	<Button class="rounded-full" {disabled} onclick={() => cover('close')}>Close</Button>
</div>
