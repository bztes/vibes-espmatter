<!-- Developer view: every widget of the device web interface on its own, with the device API mocked. -->
<script lang="ts">
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import Workflow from '@lucide/svelte/icons/workflow';
	import ChartLine from '@lucide/svelte/icons/chart-line';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Card from '#lib/device-ui/Card.svelte';
	import { Code, CodeBlock } from '#lib/ui/index.ts';
	import Shell from '#lib/device-ui/Shell.svelte';
	import { registerSpotItems } from '#sdk/device-ui';
	import { spotStories, mockFetch, stories, widgetStories } from '#lib/device-ui/stories.ts';
	import type { ShellWidget } from '#lib/device-ui/types.ts';

	const key = $derived(page.url.searchParams.get('story') ?? '');
	const shell = $derived(key === 'shell');
	const story = $derived.by(() => {
		const at = key.lastIndexOf('/');
		return stories[key.slice(0, at)]?.find((s) => s.name === key.slice(at + 1));
	});

	/** The shell with the first story of every widget, all mocks merged (first story wins). */
	const all = widgetStories.filter(
		(s, i) => widgetStories.findIndex((o) => o.component === s.component) === i
	);
	/** What the spot items fetch, under every story's own answers. */
	const spotApi = Object.assign({}, ...spotStories.map((a) => a.api ?? {}));
	const merged = Object.assign(
		{},
		spotApi,
		...Object.values(stories)
			.flatMap((l) => l.map((s) => s.api ?? {}))
			.reverse()
	);
	const widgets: ShellWidget[] = all.map((s) => ({
		page: s.page ?? 'dashboard',
		title: s.name,
		wide: s.wide,
		tab: s.tab,
		plain: s.plain,
		props: s.props ?? {},
		component: s.component
	}));

	// Installed right away (not in an effect): widgets start fetching in their own effects, which run first.
	mockFetch(() => (shell ? merged : { ...spotApi, ...story?.api }));
	registerSpotItems(spotStories);
	const link = (dir: string, name: string) =>
		`${resolve('/dev/ui')}?story=${encodeURIComponent(`${dir}/${name}`)}`;
</script>

<svelte:head><title>Device UI – dev</title></svelte:head>

<div class="flex min-h-screen bg-bg text-fg max-md:flex-col">
	<nav
		class="w-64 shrink-0 border-r border-border bg-surface p-4 text-sm md:h-screen md:overflow-y-auto"
	>
		<div class="mb-1 font-semibold">Device UI components</div>
		<p class="mt-0 mb-3 text-xs text-muted">
			Hidden developer view. API calls are mocked from each <Code>stories.ts</Code>.
		</p>
		<a
			href="{resolve('/dev/ui')}?story=shell"
			class={[
				'mb-3 block rounded-md px-2 py-1.5 font-medium no-underline',
				shell ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-surface-2'
			]}>Full shell preview</a
		>
		{#each Object.entries(stories) as [dir, list] (dir)}
			<h2 class="mt-4 mb-1 font-mono text-[11px] font-medium tracking-wide text-muted">{dir}</h2>
			{#each list as s (s.name)}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- built with resolve() in link() -->
				<a
					href={link(dir, s.name)}
					class={[
						'block rounded-md px-2 py-1 no-underline',
						s === story ? 'bg-accent-soft font-medium text-accent' : 'text-fg hover:bg-surface-2'
					]}>{s.name}</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/each}
		{/each}
	</nav>

	<main class="min-w-0 flex-1 md:h-screen md:overflow-y-auto">
		{#if shell}
			<Shell
				preview
				device={{ name: 'Living room hub', kind: 'hub' }}
				pages={[
					{ id: 'dashboard', title: 'Dashboard', path: '/', icon: LayoutDashboard },
					{ id: 'automations', title: 'Automations', path: '/automations', icon: Workflow },
					{ id: 'history', title: 'History', path: '/history', icon: ChartLine },
					{ id: 'settings', title: 'Admin', path: '/admin', icon: SettingsIcon, menu: true }
				]}
				{widgets}
			/>
		{:else if story}
			<div class="p-8">
				<div class="mb-4 font-mono text-xs text-muted">{key}</div>
				{#key key}
					<div class={story.wide ? 'max-w-3xl' : 'max-w-sm'}>
						<Card title={story.name} wide={story.wide}><story.component {...story.props} /></Card>
					</div>
				{/key}
				{#if story.api}
					<details class="mt-6 max-w-3xl text-xs">
						<summary class="cursor-pointer text-muted">Mocked API</summary>
						<CodeBlock class="mt-2">{JSON.stringify(story.api, null, 2)}</CodeBlock>
					</details>
				{/if}
			</div>
		{:else}
			<div class="grid h-full place-items-center p-8 text-sm text-muted">
				Pick a component on the left.
			</div>
		{/if}
	</main>
</div>
