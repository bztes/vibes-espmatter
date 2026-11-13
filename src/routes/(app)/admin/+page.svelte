<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Server from '@lucide/svelte/icons/server';
	import Settings from '@lucide/svelte/icons/settings';
	import Users from '@lucide/svelte/icons/users';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { getMe } from '#lib/remote/auth.remote.ts';
	import {
		addRunner,
		deleteRunner,
		deleteUser,
		getServerSettings,
		inviteUser,
		listRunners,
		listUsers,
		resetPassword,
		saveServerSettings,
		runnerStatus,
		setRunnerEnabled,
		updateUser
	} from '#lib/remote/admin.remote.ts';
	import {
		Badge,
		Button,
		Card,
		Code,
		CopyButton,
		Dialog,
		Field,
		Input,
		Notice,
		relativeTime,
		Select,
		Tabs,
		Toggle
	} from '#lib/ui/index.ts';

	const tab = $derived(page.url.searchParams.get('tab') ?? 'users');
	const me = $derived(await getMe());
	const href = (t: string) => `${resolve('/(app)/admin')}?tab=${t}`;
	const tabs = [
		{ id: 'users', label: 'Users', href: href('users'), icon: Users },
		{ id: 'settings', label: 'Settings', href: href('settings'), icon: Settings },
		{ id: 'runners', label: 'Build runners', href: href('runners'), icon: Server }
	];

	let error = $state('');
	let secret = $state<{ who: string; password: string }>();
	async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
		error = '';
		try {
			return await fn();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	// Invite
	let inviting = $state(false);
	let invite = $state({ name: '', email: '', role: 'user' as 'user' | 'admin' });
	async function sendInvite(e: SubmitEvent) {
		e.preventDefault();
		const r = await run(() => inviteUser(invite));
		if (r) {
			secret = { who: invite.email, password: r.password };
			inviting = false;
			invite = { name: '', email: '', role: 'user' };
		}
	}

	// Settings
	/** The edited public URL (undefined: untouched), saved shortly after the last change. */
	let publicUrl = $state<string>();
	let publicUrlError = $state('');
	$effect(() => {
		if (publicUrl === undefined) return;
		const value = publicUrl.trim();
		const timer = setTimeout(async () => {
			try {
				await saveServerSettings({ publicUrl: value });
				publicUrlError = '';
			} catch (e) {
				publicUrlError = e instanceof Error ? e.message : String(e);
			}
		}, 700);
		return () => clearTimeout(timer);
	});

	// Runners
	const STATUS = {
		disabled: { label: 'disabled', tone: 'warn' },
		offline: { label: 'offline', tone: 'err' },
		idle: { label: 'idle', tone: 'neutral' },
		building: { label: 'building', tone: 'accent' }
	} as const;
	const statuses = runnerStatus();
	let addingRunner = $state(false);
	let runnerName = $state('');
	let runnerToken = $state<{ name: string; token: string }>();
	async function submitRunner(e: SubmitEvent) {
		e.preventDefault();
		const name = runnerName.trim();
		const r = await run(() => addRunner({ name }));
		if (r) {
			runnerToken = { name, token: r.token };
			addingRunner = false;
			runnerName = '';
		}
	}
</script>

<svelte:head><title>Admin – espmatter studio</title></svelte:head>

<div class="border-b border-border bg-surface">
	<div class="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
		<h1 class="m-0 text-xl font-semibold tracking-tight">Administration</h1>
		<div class="mt-4"><Tabs {tabs} current={tab} /></div>
	</div>
</div>

<div class="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6">
	{#if error}<Notice tone="err">{error}</Notice>{/if}
	{#if secret}
		<Notice tone="ok">
			<div class="flex flex-wrap items-center gap-2">
				Password for <strong>{secret.who}</strong>:
				<Code class="rounded bg-surface px-2 py-0.5 text-fg">{secret.password}</Code>
				<CopyButton text={secret.password} />
				<span class="text-xs"
					>Shown once – pass it on securely. It must be changed at the first sign-in.</span
				>
				<Button
					variant="link"
					size="sm"
					class="ml-auto text-current"
					onclick={() => (secret = undefined)}>Dismiss</Button
				>
			</div>
		</Notice>
	{/if}

	{#if tab === 'users'}
		{@const users = await listUsers()}
		<Card
			title="Users"
			description="The first account is an admin. Admins manage users, sign-up and build runners."
			flush
		>
			{#snippet actions()}<Button size="sm" variant="primary" onclick={() => (inviting = true)}
					><Plus size={15} />Add user</Button
				>{/snippet}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="text-left text-xs text-muted">
							<th class="px-5 py-2 font-medium">User</th>
							<th class="px-3 py-2 font-medium">Role</th>
							<th class="px-3 py-2 font-medium">Devices</th>
							<th class="px-3 py-2 font-medium">Last sign-in</th>
							<th class="px-3 py-2 font-medium">Active</th>
							<th class="px-5 py-2"></th>
						</tr>
					</thead>
					<tbody>
						{#each users as u (u.id)}
							<tr class="border-t border-border">
								<td class="px-5 py-2.5">
									<div class="font-medium">
										{u.name}
										{#if u.id === me?.id}<Badge>you</Badge>{/if}
										{#if u.mustChangePassword}<Badge tone="warn">password not changed yet</Badge
											>{/if}
									</div>
									<div class="text-xs text-muted">{u.email}</div>
								</td>
								<td class="px-3 py-2.5">
									<Select
										class="h-8 w-28"
										value={u.role}
										disabled={u.id === me?.id}
										onchange={(e) =>
											run(() =>
												updateUser({ id: u.id, role: e.currentTarget.value as 'admin' | 'user' })
											)}
									>
										<option value="user">User</option>
										<option value="admin">Admin</option>
									</Select>
								</td>
								<td class="px-3 py-2.5 text-muted">{u.devices}</td>
								<td class="px-3 py-2.5 text-muted">{relativeTime(u.lastLoginAt)}</td>
								<td class="px-3 py-2.5">
									<Toggle
										label="Active"
										checked={!u.disabled}
										disabled={u.id === me?.id}
										onchange={(on) => run(() => updateUser({ id: u.id, disabled: !on }))}
									/>
								</td>
								<td class="px-5 py-2.5 text-right whitespace-nowrap">
									{#if u.id !== me?.id}
										<Button
											size="sm"
											variant="ghost"
											onclick={async () => {
												const r = await run(() => resetPassword(u.id));
												if (r) secret = { who: u.email, password: r.password };
											}}>Reset password</Button
										>
										<Button
											size="sm"
											variant="ghost"
											class="text-err"
											onclick={() =>
												confirm(`Delete ${u.email} and all their devices?`) !== false &&
												run(() => deleteUser(u.id))}>Delete</Button
										>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Card>
	{:else if tab === 'settings'}
		{@const s = await getServerSettings()}
		<Card
			title="Sign-up"
			description="Whether anyone who reaches this server can create an account."
		>
			<div class="flex items-start gap-3">
				<Toggle
					label="Allow sign-up"
					checked={s.signUpEnabled}
					onchange={(v) => run(() => saveServerSettings({ signUpEnabled: v }))}
				/>
				<div class="text-sm">
					<div class="font-medium">Open sign-up</div>
					<div class="text-xs text-muted">Off: only admins add users (Users → Add user).</div>
				</div>
			</div>
		</Card>
		<Card
			title="Public URL"
			description="Where devices reach this app to pull updates and report back. Built into the firmware."
		>
			<div class="max-w-xl">
				<Input
					mono
					placeholder="http://192.168.1.10:3000"
					value={publicUrl ?? s.publicUrl}
					oninput={(e) => (publicUrl = e.currentTarget.value)}
				/>
			</div>
			{#if publicUrlError}<p class="mt-2 mb-0 text-xs text-err">
					{publicUrlError}
				</p>{/if}
			<p class="mt-2 mb-0 text-xs text-muted">
				Use an address the devices can resolve – usually the LAN IP, not <Code>localhost</Code>. If
				the app is on the internet, use <Code>https://</Code>: devices verify the certificate, and
				the token isn’t sent in clear text. If this server can reach the devices too, it asks them
				to check right away after a release. Empty: the address the build was started from.
			</p>
			<p class="mt-2 mb-0 text-xs text-muted">
				Devices with the Remote access feature get a hostname of their own below the host of their
				app URL – this one, unless a device has its own: <Code>&lt;name&gt;.{s.deviceDomain}</Code
				>{#if s.deviceDomain === 'localhost'}
					– only on this computer; use a domain (not an IP address) to reach them from elsewhere{/if}.
				Point a wildcard DNS record (<Code>*.{s.deviceDomain}</Code>) at this app, with a wildcard
				certificate in your reverse proxy.
			</p>
		</Card>
	{:else if tab === 'runners'}
		{@const runners = await listRunners()}
		<Card
			title="Build runners"
			description="Where firmware is compiled. Without one, devices can be configured but not built."
		>
			{#snippet actions()}<Button size="sm" variant="primary" onclick={() => (addingRunner = true)}
					><Plus size={15} />Add runner</Button
				>{/snippet}
			{#if runnerToken}
				<Notice tone="ok">
					<div class="grid gap-2">
						<div class="flex flex-wrap items-center gap-2">
							Token for <strong>{runnerToken.name}</strong>:
							<Code class="rounded bg-surface px-2 py-0.5 break-all text-fg"
								>{runnerToken.token}</Code
							>
							<CopyButton text={runnerToken.token} />
							<Button
								variant="link"
								size="sm"
								class="ml-auto text-current"
								onclick={() => (runnerToken = undefined)}>Dismiss</Button
							>
						</div>
						<span class="text-xs"
							>Shown once. Set it as <Code>RUNNER_TOKEN</Code> in <Code>runner/.env</Code>, with <Code
								>APP_URL</Code
							> (where the runner reaches the app), then <Code>docker compose up -d</Code> in <Code
								>runner/</Code
							>.</span
						>
					</div>
				</Notice>
			{:else if !runners.length}
				<Notice tone="info">
					Add a runner and start it with its token. It only calls the app, so it may sit behind NAT.
				</Notice>
			{/if}
			<div class="grid gap-3">
				{#each runners as r (r.id)}
					{@const rs = statuses.current?.[r.id]}
					{@const st = STATUS[rs?.status ?? 'offline']}
					<div class="rounded-xl border border-border p-4">
						<div class="flex flex-wrap items-center gap-3">
							<Server size={18} class="text-muted" />
							<div class="min-w-0">
								<div class="font-semibold">
									{r.name}
									<Badge tone={st.tone}
										>{st.label}{#if rs?.status === 'building'}
											· {rs.busy}/{r.concurrency}{/if}</Badge
									>
								</div>
								<div class="truncate font-mono text-xs text-muted">
									{#if r.lastSeen}
										ESP-IDF {r.idfVersion} · {r.concurrency} at a time{#if rs?.status === 'offline'}
											· last seen {r.lastSeen.toLocaleString()}{/if}
									{:else}
										never connected
									{/if}
								</div>
							</div>
							<div class="ml-auto flex gap-2">
								<Button
									size="sm"
									variant="ghost"
									onclick={() => run(() => setRunnerEnabled({ id: r.id, enabled: !r.enabled }))}
									>{r.enabled ? 'Disable' : 'Enable'}</Button
								>
								<Button
									size="sm"
									variant="ghost"
									class="text-err"
									onclick={() =>
										confirm(`Delete runner "${r.name}"? Its token stops working.`) !== false &&
										run(() => deleteRunner(r.id))}>Delete</Button
								>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</Card>
	{/if}
</div>

<Dialog bind:open={inviting} title="Add user">
	<form id="invite" class="grid gap-4" onsubmit={sendInvite}>
		<Field label="Name" id="inv-name"
			><Input id="inv-name" required bind:value={invite.name} /></Field
		>
		<Field label="Email" id="inv-email"
			><Input id="inv-email" type="email" required bind:value={invite.email} /></Field
		>
		<Field label="Role" id="inv-role">
			<Select id="inv-role" bind:value={invite.role}
				><option value="user">User</option><option value="admin">Admin</option></Select
			>
		</Field>
		<p class="m-0 text-xs text-muted">
			A random password is generated and shown once. The user sets their own at the first sign-in.
		</p>
	</form>
	{#snippet footer()}
		<Button onclick={() => (inviting = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="invite">Add</Button>
	{/snippet}
</Dialog>

<Dialog bind:open={addingRunner} title="Add build runner">
	<form id="add-runner" class="grid gap-4" onsubmit={submitRunner}>
		<Field label="Name" id="runner-name"
			><Input id="runner-name" required maxlength={80} bind:value={runnerName} /></Field
		>
		<p class="m-0 text-xs text-muted">
			A token for the runner is generated and shown once. Deleting the runner revokes it.
		</p>
	</form>
	{#snippet footer()}
		<Button onclick={() => (addingRunner = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="add-runner">Add</Button>
	{/snippet}
</Dialog>
