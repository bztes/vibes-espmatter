<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Shield from '@lucide/svelte/icons/shield';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Logo from '#lib/components/Logo.svelte';
	import { getMe, signOut } from '#lib/remote/auth.remote.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const me = $derived(await getMe());
	const nav = $derived([
		{
			href: resolve('/(app)'),
			label: 'Devices',
			active: page.url.pathname === '/' || page.url.pathname.startsWith('/devices')
		},
		{
			href: resolve('/(app)/firmware'),
			label: 'Firmware',
			active: page.url.pathname.startsWith('/firmware')
		}
	]);

	let menuOpen = $state(false);
	let menuEl = $state<HTMLElement>();
	const initials = $derived(
		(me?.name || me?.email || '?')
			.split(/\s+/)
			.map((w) => w[0])
			.slice(0, 2)
			.join('')
			.toUpperCase()
	);

	afterNavigate(() => (menuOpen = false));
</script>

<svelte:window
	onclick={(e) => {
		if (menuOpen && menuEl && !menuEl.contains(e.target as Node)) menuOpen = false;
	}}
	onkeydown={(e) => {
		if (menuOpen && e.key === 'Escape') menuOpen = false;
	}}
/>

<div class="flex min-h-screen flex-col bg-bg">
	<header class="sticky top-0 z-30 border-b border-border bg-surface/85 backdrop-blur">
		<div class="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
			<a href={resolve('/(app)')} class="no-underline"><Logo /></a>
			<nav class="flex gap-1">
				{#each nav as item (item.href)}
					<a
						href={item.href}
						class={[
							'rounded-lg px-3 py-1.5 text-sm font-medium no-underline',
							item.active ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg'
						]}>{item.label}</a
					>
				{/each}
			</nav>
			{#if me}
				<div class="relative ml-auto" bind:this={menuEl}>
					<button
						type="button"
						class={[
							'flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 hover:bg-surface-2',
							menuOpen && 'bg-surface-2'
						]}
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						onclick={() => (menuOpen = !menuOpen)}
					>
						<span
							class="grid size-7 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-fg ring-1 ring-border"
							>{initials}</span
						>
						<span class="hidden text-sm font-medium sm:inline">{me.name}</span>
						<ChevronDown size={14} class="text-muted" />
					</button>
					{#if menuOpen}
						<div
							role="menu"
							class="absolute top-full right-0 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg"
						>
							<div class="border-b border-border px-3 py-2">
								<div class="truncate text-sm font-medium">{me.name}</div>
								<div class="flex items-center gap-1 truncate text-xs text-muted">
									{#if me.role === 'admin'}<Shield size={11} />admin ·{/if}
									{me.email}
								</div>
							</div>
							{#if me.role === 'admin'}
								<a
									role="menuitem"
									href={resolve('/(app)/admin')}
									class={[
										'flex items-center gap-2 px-3 py-2 text-sm no-underline hover:bg-surface-2',
										page.url.pathname.startsWith('/admin') ? 'text-fg' : 'text-muted hover:text-fg'
									]}
								>
									<Shield size={16} />Admin
								</a>
							{/if}
							<a
								role="menuitem"
								href={resolve('/(auth)/password')}
								class="flex items-center gap-2 px-3 py-2 text-sm text-muted no-underline hover:bg-surface-2 hover:text-fg"
							>
								<KeyRound size={16} />Change password
							</a>
							<form {...signOut} class="border-t border-border">
								<button
									type="submit"
									role="menuitem"
									class="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg"
								>
									<LogOut size={16} />Sign out
								</button>
							</form>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</header>
	<main class="flex-1">{@render children()}</main>
</div>
