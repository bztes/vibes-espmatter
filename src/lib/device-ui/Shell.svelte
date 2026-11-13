<!--
  The device web interface: login, pages (hash routing) and the widget grid. The header links the
  pages (on phones the user menu does); the user menu has those marked `menu` (the admin page), the own password, logging out. `#/` is the dashboard (the page with
  path `/`); a page whose widgets have several tabs shows a tab bar (`#/admin/<tab>`). Hub accounts
  change their own password here; with a generated one (new account, reset) they must first.
-->
<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import LogOut from '@lucide/svelte/icons/log-out';
	import { onMount, untrack } from 'svelte';
	import {
		Button,
		Notice,
		api,
		errorText,
		getToken,
		onUnauthorized,
		session,
		setToken
	} from '#sdk/device-ui';
	import Card from './Card.svelte';
	import type { ShellPage, ShellProps } from './types';

	let { device, pages, widgets, preview = false }: ShellProps = $props();

	let authed = $state<boolean | undefined>(untrack(() => (preview ? true : undefined)));
	// The firmware's name until the device tells its own (one firmware, many devices).
	let name = $state(untrack(() => device.name));
	let user = $state('');
	let password = $state('');
	let loginError = $state('');
	/** Changing the own password: `forced` while the password is a generated one. */
	let changing = $state<'forced' | 'voluntary'>();
	let pw = $state({ current: '', next: '', confirm: '' });
	let pwError = $state('');
	let pwDone = $state(false);
	let pwBusy = $state(false);
	/** Just logged in with the generated password: it is the current one, no need to ask again. */
	let currentKnown = $state(false);
	let hash = $state('');

	/** Hubs have accounts: admins, and users who see only what they have grants for. */
	const accounts = $derived(device.kind === 'hub');
	const allowed = $derived(widgets.filter((w) => session.admin || w.access === 'account'));
	const shown = $derived(pages.filter((p) => allowed.some((w) => w.page === p.id)));
	/** The path after `#`, `/` for none. */
	const route = $derived(hash.replace(/^#/, '') || '/');
	const onPage = (path: string) =>
		path === '/' ? route === '/' : route === path || route.startsWith(path + '/');
	/** The dashboard (`/`) is home; without one (a device, or no dashboard), the first page. */
	const home = $derived(shown.find((p) => p.path === '/') ?? shown[0]);
	const navPages = $derived(shown.filter((p) => !p.menu));
	const menuPages = $derived(shown.filter((p) => p.menu));
	const current = $derived(shown.find((p) => onPage(p.path)) ?? home);
	const onCurrent = $derived(allowed.filter((w) => w.page === current?.id));

	const slug = (tab: string) => tab.toLowerCase().replace(/[^a-z0-9]+/g, '-');
	/** Tabs of the current page in the order of their first widget. */
	const tabs = $derived([...new Set(onCurrent.map((w) => w.tab ?? 'General'))]);
	const tab = $derived.by(() => {
		const wanted = current && current.path !== '/' ? route.slice(current.path.length + 1) : '';
		return tabs.find((t) => slug(t) === wanted) ?? tabs[0];
	});
	const visible = $derived(onCurrent.filter((w) => (w.tab ?? 'General') === tab));

	let menuOpen = $state(false);
	let menu = $state<HTMLElement>();

	interface Identity {
		user?: string;
		admin?: boolean;
		mustChange?: boolean;
	}
	/** Older firmware doesn't tell: then it's the admin. */
	function identify(who: Identity) {
		session.user = who.user ?? 'admin';
		session.admin = who.admin ?? true;
		changing = who.mustChange ? 'forced' : undefined;
	}
	/** The built-in admin's password is set in the app; accounts change theirs here. */
	const ownPassword = $derived(accounts && session.user !== 'admin');

	function startChange() {
		pw = { current: '', next: '', confirm: '' };
		pwError = '';
		pwDone = false;
		currentKnown = false;
		changing = 'voluntary';
	}

	async function changePassword(e: SubmitEvent) {
		e.preventDefault();
		pwError = '';
		if (pw.next.length < 8 || pw.next.length > 64)
			pwError = 'The new password needs 8–64 characters.';
		else if (pw.next !== pw.confirm) pwError = 'The new passwords don’t match.';
		else if (pw.next === pw.current) pwError = 'Choose a password different from the current one.';
		if (pwError) return;
		pwBusy = true;
		try {
			const res = await api<{ token: string }>('/api/v1/auth/password', {
				body: { current: pw.current, password: pw.next }
			});
			setToken(res.token);
			pw = { current: '', next: '', confirm: '' };
			changing = undefined;
			currentKnown = false;
			pwDone = true;
		} catch (err) {
			pwError = errorText(err);
			currentKnown = false; // let them check it
		} finally {
			pwBusy = false;
		}
	}

	onMount(() => {
		hash = location.hash;
		const onHash = () => (hash = location.hash);
		addEventListener('hashchange', onHash);
		onUnauthorized(() => (authed = false));
		if (!preview) {
			fetch('/api/v1/info')
				.then((r) => r.json())
				.then((info: { name?: string }) => {
					if (info.name) document.title = name = info.name;
				})
				.catch(() => {});
			if (!getToken()) authed = false;
			else
				api<Identity>('/api/v1/auth/me').then(
					(who) => {
						identify(who);
						authed = true;
					},
					() => (authed = false)
				);
		}
		return () => removeEventListener('hashchange', onHash);
	});

	async function login(e: SubmitEvent) {
		e.preventDefault();
		loginError = '';
		try {
			const body = accounts
				? { user: user.trim().toLowerCase() || 'admin', password }
				: { password };
			const res = await api<Identity & { token: string }>('/api/v1/auth/login', { body });
			setToken(res.token);
			identify(res);
			// A generated password is the current one: no need to type it again.
			pw = { current: res.mustChange ? password : '', next: '', confirm: '' };
			currentKnown = !!res.mustChange;
			password = '';
			authed = true;
		} catch (err) {
			loginError = errorText(err);
		}
	}

	function closeMenuOutside(e: MouseEvent) {
		if (menuOpen && menu && !menu.contains(e.target as Node)) menuOpen = false;
	}

	function logout() {
		menuOpen = false;
		api('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
		setToken('');
		identify({});
		pwDone = false;
		authed = false;
	}
</script>

<!-- A page link of the header, or (`inMenu`) of the user menu. -->
{#snippet pageLink(page: ShellPage, inMenu: boolean)}
	{@const here = page === current}
	<a
		role={inMenu ? 'menuitem' : undefined}
		href="#{page.path}"
		aria-current={here ? 'page' : undefined}
		class={[
			'flex items-center text-sm no-underline',
			inMenu
				? 'gap-2 rounded-md px-2.5 py-2'
				: 'h-9 gap-1.5 rounded-lg px-2.5 font-medium whitespace-nowrap',
			here
				? 'bg-accent-soft text-accent'
				: inMenu
					? 'text-fg hover:bg-surface-2'
					: 'text-muted hover:bg-surface-2 hover:text-fg'
		]}
		onclick={inMenu ? () => (menuOpen = false) : undefined}
	>
		{#if page.icon}<page.icon size={16} class={inMenu && !here ? 'text-muted' : ''} />{/if}
		{page.title}
	</a>
{/snippet}

<svelte:window
	onclick={closeMenuOutside}
	onkeydown={(e) => e.key === 'Escape' && (menuOpen = false)}
/>

<div class="min-h-screen bg-bg font-sans text-fg antialiased">
	<header class="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
		<div class="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
			<a href="#/" class="flex min-w-0 items-center gap-2 text-fg no-underline">
				<span
					class="grid size-7 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-fg"
					>{name.slice(0, 1).toUpperCase()}</span
				>
				<span class="truncate font-semibold">{name}</span>
			</a>
			{#if authed && !changing && navPages.length > 1}
				<nav class="flex min-w-0 gap-0.5 overflow-x-auto max-sm:hidden" aria-label="Pages">
					{#each navPages as page (page.id)}{@render pageLink(page, false)}{/each}
				</nav>
			{/if}
			{#if authed}
				<div class="relative ml-auto" bind:this={menu}>
					<button
						type="button"
						class="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-fg hover:bg-surface-2"
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						onclick={() => (menuOpen = !menuOpen)}
					>
						<span
							class="grid size-6 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
							>{session.user.slice(0, 1).toUpperCase()}</span
						>
						<span class="max-w-32 truncate max-sm:hidden">{session.user}</span>
						<ChevronDown size={14} class="text-muted" />
					</button>
					{#if menuOpen}
						<div
							role="menu"
							class="absolute right-0 mt-1 grid w-56 gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-card"
						>
							<div class="px-2.5 pt-1.5 pb-2 text-xs text-muted">
								Logged in as <strong class="text-fg">{session.user}</strong>
								{#if accounts}· {session.admin ? 'admin' : 'user'}{/if}
							</div>
							{#if !changing}
								{#if navPages.length > 1}
									<!-- On phones the header has no room for the pages: they move in here. -->
									<div class="grid gap-0.5 border-b border-border pb-1 sm:hidden">
										{#each navPages as page (page.id)}{@render pageLink(page, true)}{/each}
									</div>
								{/if}
								{#each menuPages.filter((p) => p !== current) as page (page.id)}
									{@render pageLink(page, true)}
								{/each}
								{#if ownPassword}
									<button
										type="button"
										role="menuitem"
										class="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-fg hover:bg-surface-2"
										onclick={() => ((menuOpen = false), startChange())}
									>
										<KeyRound size={16} class="text-muted" /> Change password
									</button>
								{/if}
							{/if}
							<button
								type="button"
								role="menuitem"
								class="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-fg hover:bg-surface-2"
								onclick={logout}
							>
								<LogOut size={16} class="text-muted" /> Log out
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</header>

	<main class="mx-auto max-w-5xl px-4 py-6">
		{#if authed === false}
			<form
				class="mx-auto mt-12 grid max-w-xs gap-3 rounded-card border border-border bg-surface p-6 shadow-card"
				onsubmit={login}
			>
				<h1 class="m-0 text-lg font-semibold">Log in</h1>
				<p class="m-0 text-sm text-muted">
					{accounts
						? 'Your account on this hub – or “admin” with the password shown in the app under the device’s settings.'
						: 'The password is shown in the app under the device’s settings.'}
				</p>
				{#if accounts}
					<input
						autocomplete="username"
						autocapitalize="none"
						placeholder="User (admin)"
						class="h-10 rounded-lg border border-border-strong bg-surface px-3"
						bind:value={user}
					/>
				{/if}
				<input
					type="password"
					autocomplete="current-password"
					placeholder="Password"
					class="h-10 rounded-lg border border-border-strong bg-surface px-3"
					bind:value={password}
				/>
				{#if loginError}<p class="m-0 text-sm text-err">{loginError}</p>{/if}
				<Button variant="primary" type="submit">Log in</Button>
			</form>
		{:else if authed && changing}
			<form
				class="mx-auto mt-12 grid max-w-xs gap-3 rounded-card border border-border bg-surface p-6 shadow-card"
				onsubmit={changePassword}
			>
				<h1 class="m-0 text-lg font-semibold">
					{changing === 'forced' ? 'Choose your password' : 'Change password'}
				</h1>
				<p class="m-0 text-sm text-muted">
					{changing === 'forced'
						? `${session.user}, you logged in with a generated password. Set your own to continue.`
						: `For ${session.user}. Other sessions of this account are logged out.`}
				</p>
				<input type="text" autocomplete="username" value={session.user} hidden readonly />
				{#if !currentKnown}
					<input
						type="password"
						autocomplete="current-password"
						placeholder="Current password"
						required
						class="h-10 rounded-lg border border-border-strong bg-surface px-3"
						bind:value={pw.current}
					/>
				{/if}
				<input
					type="password"
					autocomplete="new-password"
					placeholder="New password (8–64 characters)"
					required
					minlength="8"
					maxlength="64"
					class="h-10 rounded-lg border border-border-strong bg-surface px-3"
					bind:value={pw.next}
				/>
				<input
					type="password"
					autocomplete="new-password"
					placeholder="Repeat new password"
					required
					class="h-10 rounded-lg border border-border-strong bg-surface px-3"
					bind:value={pw.confirm}
				/>
				{#if pwError}<p class="m-0 text-sm text-err">{pwError}</p>{/if}
				<Button variant="primary" type="submit" disabled={pwBusy}
					>{pwBusy ? 'Saving…' : 'Save password'}</Button
				>
				{#if changing === 'forced'}
					<Button variant="ghost" onclick={logout}>Log out</Button>
				{:else}
					<Button variant="ghost" onclick={() => (changing = undefined)}>Cancel</Button>
				{/if}
			</form>
		{:else if authed}
			{#if pwDone}
				<div class="mb-4"><Notice tone="ok">Your password is changed.</Notice></div>
			{/if}
			<!-- The dashboard needs no headline: the header already names the hub. -->
			{#if current?.path !== '/'}
				<h1 class="mt-0 mb-4 text-xl font-semibold">{current?.title}</h1>
			{/if}
			{#if tabs.length > 1}
				<nav
					class="mb-5 flex gap-1 overflow-x-auto border-b border-border"
					aria-label="{current?.title} sections"
				>
					{#each tabs as t (t)}
						<a
							href="#{current?.path}/{slug(t)}"
							aria-current={t === tab ? 'page' : undefined}
							class={[
								'-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap no-underline',
								t === tab
									? 'border-accent text-accent'
									: 'border-transparent text-muted hover:text-fg'
							]}>{t}</a
						>
					{/each}
				</nav>
			{/if}
			<div class="grid gap-4 sm:grid-cols-2">
				{#each visible as widget, i (i)}
					{#if widget.plain}
						<div class="min-w-0 sm:col-span-2">
							<widget.component {...widget.props} />
						</div>
					{:else}
						<Card title={widget.title} wide={widget.wide}>
							<widget.component {...widget.props} />
						</Card>
					{/if}
				{:else}
					<p class="text-muted">Nothing here yet.</p>
				{/each}
			</div>
		{/if}
	</main>
</div>
