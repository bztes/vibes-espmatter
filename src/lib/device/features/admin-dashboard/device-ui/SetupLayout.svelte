<!--
	Setup page of every device, split into sections (`/admin#/<section>`, see DevicePanel.section). Each
	section shows its main panels on the left and its side panels in a sidebar on the right. Panels
	of the `status` area are small badges in the header, on every section.
-->
<script lang="ts">
	import Cpu from '@lucide/svelte/icons/cpu';
	import Lightbulb from '@lucide/svelte/icons/lightbulb';
	import Network from '@lucide/svelte/icons/network';
	import Users from '@lucide/svelte/icons/users';
	import Unplug from '@lucide/svelte/icons/unplug';
	import Workflow from '@lucide/svelte/icons/workflow';
	import Header from '../../web-ui/device-ui/Header.svelte';
	import { Badge } from '../../../device-ui/ui';
	import { live } from '../../web-ui/device-ui/live.svelte';
	import type { LayoutProps, SystemStatus } from '../../web-ui/device-ui/types';

	let { device, page, panels: all }: LayoutProps = $props();

	const badges = $derived(all.filter((p) => p.area === 'status'));
	const panels = $derived(all.filter((p) => p.area !== 'status'));

	/** Known sections in menu order; others follow, named after their id. */
	const SECTIONS = [
		{ id: 'devices', label: 'Devices', icon: Lightbulb },
		{ id: 'automations', label: 'Automations', icon: Workflow },
		{ id: 'network', label: 'Network', icon: Network },
		{ id: 'users', label: 'Users', icon: Users },
		{ id: 'system', label: 'System', icon: Cpu }
	];
	const sections = $derived([
		...SECTIONS.filter((s) => panels.some((p) => p.section === s.id)),
		...[...new Set(panels.map((p) => p.section))]
			.filter((id) => !SECTIONS.some((s) => s.id === id))
			.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), icon: undefined }))
	]);

	let hash = $state(location.hash);
	const wanted = $derived(hash.slice(2));
	const current = $derived(sections.find((s) => s.id === wanted) ?? sections[0]);

	const shown = $derived(panels.filter((p) => p.section === current?.id));
	const sidePanels = $derived(shown.filter((p) => p.area === 'side'));
	// A section with only side panels shows them in the main column.
	const main = $derived(
		shown.length === sidePanels.length ? sidePanels : shown.filter((p) => p.area !== 'side')
	);
	const side = $derived(main === sidePanels ? [] : sidePanels);

	const status = live<SystemStatus>('/api/status');
</script>

<Header {device} {page}>
	<!-- Phones: the header stays on one line (see Header.svelte), the full text is in the tooltip. -->
	<div class="flex gap-2 max-sm:*:px-1.5 max-sm:*:py-[3px]">
		{#if status.error}
			<Badge tone="err" title="Device unreachable"
				><Unplug size={13} /> <span class="max-sm:hidden">device unreachable</span></Badge
			>
		{:else}
			{#each badges as badge (badge.id)}
				<badge.component {...badge.props} />
			{/each}
		{/if}
	</div>
</Header>

<svelte:window onhashchange={() => (hash = location.hash)} />

{#if sections.length > 1}
	<!-- The baseline the active tab's underline sits on: a shadow (a border would make the tabs overflow). -->
	<nav
		class="mx-auto flex max-w-[1280px] gap-1 overflow-x-auto overflow-y-hidden px-4 pt-4 shadow-[inset_0_-1px_var(--color-border)]"
		aria-label="Setup sections"
	>
		{#each sections as section (section.id)}
			<a
				href="#/{section.id}"
				class={[
					'flex items-center gap-[7px] border-b-2 px-3 py-2 font-medium whitespace-nowrap no-underline',
					section === current
						? 'border-accent text-accent'
						: 'border-transparent text-muted hover:text-fg'
				]}
				aria-current={section === current ? 'page' : undefined}
			>
				{#if section.icon}<section.icon size={16} />{/if}
				{section.label}
			</a>
		{/each}
	</nav>
{/if}

<div
	class={[
		'mx-auto grid max-w-[1280px] grid-cols-[minmax(0,1fr)] items-start gap-4 px-4 py-5',
		side.length && 'min-[901px]:grid-cols-[minmax(0,1fr)_340px]'
	]}
>
	<div class="grid min-w-0 gap-4">
		{#each main as panel (panel.id)}
			<panel.component {...panel.props} />
		{/each}
	</div>
	<aside class="grid min-w-0 gap-4">
		{#each side as panel (panel.id)}
			<panel.component {...panel.props} />
		{/each}
	</aside>
</div>
