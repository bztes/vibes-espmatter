<!-- Top bar: device name, status chips and the user menu (with the other pages this user may open). -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import LogOut from '@lucide/svelte/icons/log-out';
	import CircleUser from '@lucide/svelte/icons/circle-user';
	import { auth, logout } from './auth.svelte';
	import ChangePassword from './ChangePassword.svelte';
	import Logo from '../../../device-ui/Logo.svelte';
	import Menu, { type MenuItem } from '../../../device-ui/Menu.svelte';
	import Dialog from '../../../device-ui/ui/Dialog.svelte';
	import type { DeviceInfo } from './types';

	let { device, page, children }: { device: DeviceInfo; page: string; children?: Snippet } =
		$props();

	const session = $derived(auth.session);
	const loggedIn = $derived(Boolean(session?.authEnabled && session.authenticated));
	/** The other pages this user may open. */
	const pages = $derived(
		device.pages.filter((p) => p.id !== page && (p.access === 'user' || session?.role === 'admin'))
	);
	const items = $derived<MenuItem[]>([
		...pages.map((p) => ({
			label: p.title,
			icon: p.icon,
			onclick: () => location.assign(p.path)
		})),
		...(loggedIn
			? [
					{ label: 'Change password', icon: KeyRound, onclick: () => dialog?.open() },
					{ label: 'Log out', icon: LogOut, onclick: logout }
				]
			: [])
	]);

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
	<div class="ml-auto flex items-center gap-3 text-sm max-sm:shrink-0 max-sm:gap-1.5">
		{@render children?.()}
		{#if items.length}
			<Menu label={loggedIn ? 'Account' : 'Pages'} variant="ghost" {items}>
				{#snippet trigger()}
					<CircleUser size={17} />
					{#if loggedIn}
						<span class="max-w-[12ch] truncate max-sm:hidden">{session?.user}</span>
					{/if}
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
