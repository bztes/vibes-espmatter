<!-- Top bar: device name, the page menu (the pages this user may open), status chips and the user menu. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import LogOut from '@lucide/svelte/icons/log-out';
	import CircleUser from '@lucide/svelte/icons/circle-user';
	import { auth, logout } from './auth.svelte';
	import ChangePassword from './ChangePassword.svelte';
	import Logo from '../../../device-ui/Logo.svelte';
	import Menu from '../../../device-ui/Menu.svelte';
	import Dialog from '../../../device-ui/ui/Dialog.svelte';
	import type { DeviceInfo } from './types';

	let { device, page, children }: { device: DeviceInfo; page: string; children?: Snippet } =
		$props();

	const session = $derived(auth.session);
	const loggedIn = $derived(Boolean(session?.authEnabled && session.authenticated));
	const tabs = $derived(
		device.pages.filter((p) => p.access === 'user' || session?.role === 'admin')
	);

	let dialog = $state<ReturnType<typeof Dialog>>();
</script>

<svelte:head><title>{device.name}</title></svelte:head>

<header
	class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b bg-card px-5 py-2.5 max-sm:flex-nowrap max-sm:gap-2.5 max-sm:px-3 max-sm:py-2"
>
	<div class="flex min-w-0 items-center gap-2.5 max-sm:gap-2">
		<Logo size={26} />
		<h1 class="m-0 truncate text-lg text-fg max-sm:text-[16px]">{device.name}</h1>
	</div>
	{#if tabs.length > 1}
		<nav class="flex gap-1 rounded-[10px] border bg-bg p-[3px]" aria-label="Pages">
			{#each tabs as tab (tab.id)}
				<a
					href={tab.path}
					class={[
						'flex items-center gap-[7px] rounded-[7px] px-3.5 py-1.5 font-medium no-underline max-sm:px-[9px]',
						tab.id === page
							? 'bg-card text-accent shadow-[0_1px_3px_rgb(0_0_0/0.12)]'
							: 'text-muted hover:text-fg'
					]}
					aria-current={tab.id === page ? 'page' : undefined}
					title={tab.title}
				>
					{#if tab.icon}<tab.icon size={17} />{/if}
					<span class="max-sm:hidden">{tab.title}</span>
				</a>
			{/each}
		</nav>
	{/if}
	<div class="ml-auto flex items-center gap-3 text-sm max-sm:shrink-0 max-sm:gap-1.5">
		{@render children?.()}
		{#if loggedIn}
			<Menu
				label="Account"
				variant="ghost"
				items={[
					{ label: 'Change password', icon: KeyRound, onclick: () => dialog?.open() },
					{ label: 'Log out', icon: LogOut, onclick: logout }
				]}
			>
				{#snippet trigger()}
					<CircleUser size={17} />
					<span class="max-w-[12ch] truncate max-sm:hidden">{session?.user}</span>
					<ChevronDown size={14} />
				{/snippet}
			</Menu>
		{/if}
	</div>
</header>

{#if loggedIn}
	<Dialog bind:this={dialog} width={380}>
		<ChangePassword ondone={() => dialog?.close()} />
	</Dialog>
{/if}
