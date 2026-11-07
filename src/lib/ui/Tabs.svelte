<!-- Tabs as links (`?tab=…`), so each tab has a URL. -->
<script lang="ts">
	import type { Component } from 'svelte';

	let {
		tabs,
		current
	}: {
		tabs: {
			id: string;
			label: string;
			href: string;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			icon?: Component<any>;
			badge?: string | number;
			tone?: 'err' | 'warn';
		}[];
		current: string;
	} = $props();
</script>

<nav class="-mb-px flex gap-1 overflow-x-auto" aria-label="Sections">
	{#each tabs as tab (tab.id)}
		<!-- eslint-disable svelte/no-navigation-without-resolve -- callers pass resolved hrefs -->
		<a
			href={tab.href}
			data-sveltekit-reset="false"
			aria-current={tab.id === current ? 'page' : undefined}
			class={[
				'flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium no-underline transition-colors',
				tab.id === current ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'
			]}
		>
			{#if tab.icon}<tab.icon size={16} />{/if}
			{tab.label}
			{#if tab.badge}
				<span
					class={[
						'rounded-full px-1.5 text-xs leading-5',
						tab.tone === 'err'
							? 'bg-err-soft text-err'
							: tab.tone === 'warn'
								? 'bg-warn-soft text-warn'
								: 'bg-surface-2 text-muted'
					]}>{tab.badge}</span
				>
			{/if}
		</a>
	{/each}
</nav>
