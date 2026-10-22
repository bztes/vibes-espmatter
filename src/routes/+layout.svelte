<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import Logo from '#lib/device/device-ui/Logo.svelte';
	import { Button, Dialogs } from '#lib/device/device-ui/ui/index.ts';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getUser, signOut } from '#lib/api/auth.remote.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const user = $derived(await getUser());
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
					<span class="text-muted max-sm:hidden">{user.name}</span>
					<form {...signOut}>
						<Button type="submit">Sign out</Button>
					</form>
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
	</footer>
</div>

<Dialogs />
