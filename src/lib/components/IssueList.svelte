<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Info from '@lucide/svelte/icons/info';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { Issue } from '#sdk';

	let {
		issues,
		compact = false,
		onselect
	}: { issues: Issue[]; compact?: boolean; onselect?: (issue: Issue) => void } = $props();

	const order = { error: 0, warning: 1, info: 2 };
	const sorted = $derived([...issues].sort((a, b) => order[a.severity] - order[b.severity]));
	const icons = { error: CircleAlert, warning: TriangleAlert, info: Info };
	const tones = { error: 'text-err', warning: 'text-warn', info: 'text-info' };
</script>

{#if sorted.length}
	<ul class="m-0 grid list-none gap-1 p-0">
		{#each sorted as issue, i (i)}
			{@const Icon = icons[issue.severity]}
			<li>
				<svelte:element
					this={onselect ? 'button' : 'div'}
					type={onselect ? 'button' : undefined}
					role={onselect ? undefined : 'listitem'}
					class={[
						'flex w-full items-start gap-2 rounded-lg text-left text-sm',
						compact ? 'px-0 py-1' : 'px-2 py-1.5',
						onselect && 'hover:bg-surface-2'
					]}
					onclick={() => onselect?.(issue)}
				>
					<Icon size={16} class={['mt-0.5 shrink-0', tones[issue.severity]]} />
					<span class={issue.severity === 'info' ? 'text-muted' : ''}>{issue.message}</span>
				</svelte:element>
			</li>
		{/each}
	</ul>
{/if}
