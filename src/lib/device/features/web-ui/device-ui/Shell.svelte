<!-- Mounted by the generated entry: login (and a forced password change) when needed, then the page's layout. -->
<script lang="ts">
	import type { Component } from 'svelte';
	import { errorMessage } from './api';
	import { auth, checkSession } from './auth.svelte';
	import ChangePassword from './ChangePassword.svelte';
	import Dialogs from '../../../device-ui/ui/Dialogs.svelte';
	import Login from './Login.svelte';
	import Panel from './Panel.svelte';
	import type { DeviceInfo, LayoutProps, PanelEntry } from './types';

	let {
		layout: Layout,
		device,
		panels,
		page
	}: {
		layout: Component<LayoutProps>;
		device: DeviceInfo;
		panels: PanelEntry[];
		/** Id of this page (`device.pages`). */
		page: string;
	} = $props();

	const adminsOnly = $derived(device.pages.find((p) => p.id === page)?.access === 'admin');
	/** Where users who aren't admins can go instead. */
	const elsewhere = $derived(device.pages.find((p) => p.access === 'user'));

	let error = $state('');
	checkSession().catch((e) => (error = errorMessage(e)));
</script>

{#if !auth.session}
	<p class="grid min-h-[60vh] place-items-center p-4 text-center text-muted">
		{error ? `Device not reachable: ${error}` : 'Loading…'}
	</p>
{:else if !auth.session.authenticated}
	<Login {device} />
{:else if auth.session.mustChangePassword}
	<main class="grid min-h-[60vh] place-items-center p-4 text-center">
		<Panel class="w-[min(380px,100%)] text-left"><ChangePassword forced /></Panel>
	</main>
{:else if adminsOnly && auth.session.role !== 'admin'}
	<p class="grid min-h-[60vh] place-items-center p-4 text-center">
		This page is for admins only{#if elsewhere}
			– go to the <a href={elsewhere.path}>{elsewhere.title}</a>{/if}.
	</p>
{:else}
	<Layout {device} {page} {panels} />
{/if}

<Dialogs />
