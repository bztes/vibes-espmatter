<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import Logo from '#lib/device/device-ui/Logo.svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import CircleUser from '@lucide/svelte/icons/circle-user';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Shield from '@lucide/svelte/icons/shield';
	import { Button, Dialogs, Menu, type MenuItem } from '#lib/device/device-ui/ui/index.ts';
	import { version } from '$app/env';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getUser, signOut } from '#lib/api/auth.remote.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const user = $derived(await getUser());

	let signOutForm = $state<HTMLFormElement>();
	const userMenu = $derived<MenuItem[]>([
		...(user?.admin
			? [{ label: 'Admin', icon: Shield, onclick: () => goto(resolve('/admin')) }]
			: []),
		{ label: 'Sign out', icon: LogOut, onclick: () => signOutForm?.requestSubmit() }
	]);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>vibes-espmatter</title>
</svelte:head>

<div class="flex min-h-screen flex-col">
	<header class="sticky top-0 z-20 border-b bg-card">
		<div class="mx-auto flex h-14 max-w-[1280px] items-center gap-6 px-4">
			<a href={resolve('/')} class="flex items-center gap-2 font-semibold text-fg no-underline">
				<Logo />
				vibes-espmatter
			</a>
			<div class="ml-auto flex items-center gap-3">
				{#if user}
					<Menu label="Account" variant="ghost" items={userMenu}>
						{#snippet trigger()}
							<CircleUser size={17} />
							<span class="max-w-[16ch] truncate max-sm:hidden">{user.name}</span>
							<ChevronDown size={14} />
						{/snippet}
					</Menu>
					<form {...signOut} bind:this={signOutForm} hidden></form>
				{:else}
					<Button
						href="{resolve('/login')}?redirectTo={encodeURIComponent(
							page.url.pathname + page.url.search
						)}">Sign in</Button
					>
				{/if}
			</div>
		</div>
	</header>

	<main class="flex-1">
		{@render children()}
	</main>

	<footer class="border-t px-4 py-6 text-center text-xs text-muted">
		Built with Espressif’s ESP-IDF &amp; esp-matter. Not affiliated with Espressif or the CSA.
		<span class="whitespace-nowrap">· v{version}</span>
	</footer>
</div>

<Dialogs />
