<script lang="ts">
	import { Badge, Poll, Stat } from '#sdk/device-ui';

	const thread = new Poll<{ rcp: string; role?: string; children?: number }>(
		'/api/v1/thread',
		10000
	);
</script>

{#if thread.current}
	{@const rcp = thread.current.rcp}
	<div class="flex items-end justify-between">
		<Stat label="Thread devices" value={thread.current.children ?? 0} />
		<Badge tone={rcp === 'ok' ? 'ok' : rcp === 'starting' ? 'warn' : 'err'}
			>{rcp === 'ok'
				? thread.current.role
				: rcp === 'starting'
					? 'radio starting'
					: 'radio offline'}</Badge
		>
	</div>
{/if}
