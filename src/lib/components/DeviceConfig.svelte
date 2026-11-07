<!-- The Settings tab of a device: its name and own values – per-device fields, pairing, updates, status reports, access. -->
<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { untrack } from 'svelte';
	import { slug, type Issue, type SettingValue } from '#sdk';
	import { effectiveValue, PASSWORD_SET, perDeviceScopes } from '#lib/core/device.ts';
	import { randomPassword, resolve as resolveConfig } from '#lib/core/engine.ts';
	import { KINDS } from '#lib/core/kinds.ts';
	import {
		manualPairingCode,
		qrPayload,
		randomDiscriminator,
		randomPasscode,
		validPasscode
	} from '#lib/core/matter.ts';
	import type { DeviceSettings, FirmwareConfig } from '#lib/core/model.ts';
	import { updateRoute } from '#lib/core/platform.ts';
	import {
		listHubs,
		probeDevice,
		rotateToken,
		setDevicePassword,
		updateDeviceSettings,
		type getDevice
	} from '#lib/remote/devices.remote.ts';
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
		Toggle
	} from '#lib/ui/index.ts';
	import IssueList from './IssueList.svelte';
	import SettingsFields from './SettingsFields.svelte';

	let {
		name = $bindable(),
		settings,
		effective,
		issues,
		device
	}: {
		name: string;
		/** Edited in place, saved by the workspace. */
		settings: DeviceSettings;
		/** The firmware as this device sees it (its values filled in). */
		effective: FirmwareConfig;
		issues: Issue[];
		device: Awaited<ReturnType<typeof getDevice>>;
	} = $props();

	const firmware = $derived(device.firmware.config);
	const hubs = $derived(
		device.kind === 'device' ? await listHubs(device.location?.id ?? null) : []
	);
	const resolved = $derived(resolveConfig(effective));
	const route = $derived(updateRoute(resolved));
	/** The device keeps a tunnel to the app: reachable at its own hostname, from anywhere. */
	const remote = $derived(resolved.has('remote-access'));
	const matter = $derived(KINDS[device.kind].matterDevice);
	const scopes = $derived(perDeviceScopes(firmware));
	const effectiveScopes = $derived(perDeviceScopes(effective));
	const code = $derived(manualPairingCode(settings.matter.discriminator, settings.matter.passcode));
	const qr = $derived(
		qrPayload(
			firmware.matter.vendorId,
			firmware.matter.productId,
			settings.matter.discriminator,
			settings.matter.passcode
		)
	);

	// The hostname isn't part of the device's configuration: saved on its own, shortly after the
	// last change, like the rest of the page.
	let subdomain = $state(untrack(() => device.subdomain));
	let subdomainError = $state('');
	$effect(() => {
		const value = subdomain.trim().toLowerCase();
		if (value === untrack(() => device.subdomain)) return void (subdomainError = '');
		const timer = setTimeout(async () => {
			try {
				await updateDeviceSettings({ id: device.id, subdomain: value });
				subdomainError = '';
			} catch (e) {
				subdomainError = e instanceof Error ? e.message : String(e);
			}
		}, 700);
		return () => clearTimeout(timer);
	});
	let probe = $state<{ online: boolean; info: unknown } | null>(null);
	let showToken = $state(false);
	let showPassword = $state(false);
	/** Sent on its own (`setDevicePassword`): the page never has the stored one. */
	let newPassword = $state('');
	let passwordOpen = $state(false);
	let passwordError = $state('');
	let savingPassword = $state(false);

	function openPasswordDialog() {
		newPassword = '';
		showPassword = false;
		passwordError = '';
		passwordOpen = true;
	}
	async function savePassword() {
		passwordError = '';
		savingPassword = true;
		try {
			await setDevicePassword({ id: device.id, password: newPassword });
			settings.uiPasswordHash = PASSWORD_SET;
			passwordOpen = false;
			newPassword = '';
		} catch (e) {
			passwordError = e instanceof Error ? e.message : String(e);
		} finally {
			savingPassword = false;
		}
	}
	let error = $state('');

	async function run(fn: () => Promise<unknown>) {
		error = '';
		try {
			await fn();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	function setValue(scope: string, key: string, value: SettingValue) {
		(settings.plugins[scope] ??= {})[key] = value;
	}
	function resetValue(scope: string, key: string) {
		const values = settings.plugins[scope];
		if (!values) return;
		delete values[key];
		if (!Object.keys(values).length) delete settings.plugins[scope];
	}
	const origin = (scope: string, key: string, firmwareValue: SettingValue) =>
		effectiveValue(scope, key, firmwareValue, settings).from;
	const scoped = (scope: string) => issues.filter((i) => i.scope === scope);
</script>

<div class="grid gap-8">
	{#if error}<Notice tone="err">{error}</Notice>{/if}

	<section class="grid gap-3">
		<h2 class="m-0 text-sm font-semibold text-muted">Device</h2>
		<div class="grid gap-6 lg:grid-cols-2">
			<Card title="Identity">
				<div class="grid gap-4">
					<Field label="Name" id="name" help="Shown in this app and as node label in Matter apps.">
						<Input id="name" maxlength={48} bind:value={name} />
					</Field>
					<Field
						label="Hostname"
						id="hostname"
						help="On the network (Wi-Fi, Ethernet, mDNS). Empty: from the name."
						error={issues.find((i) => i.scope === 'device' && i.field === 'hostname')?.message}
					>
						<Input
							id="hostname"
							mono
							maxlength={32}
							placeholder={slug(name, 'espmatter')}
							bind:value={settings.hostname}
						/>
					</Field>
				</div>
			</Card>

			<Card title="Access">
				<div class="grid gap-4">
					<Field
						label="Admin password"
						id="uipw"
						help={(device.kind === 'hub'
							? 'Password of the built-in “admin” account of the hub’s web interface (8–64 characters). Further accounts – admins, or users with access to chosen devices – are managed on the hub itself, under Settings → Accounts.'
							: 'The only login of the device’s web interface (8–64 characters).') +
							' Only its hash is stored, so it can’t be shown again.'}
					>
						<div class="flex items-center gap-3">
							{#if settings.uiPasswordHash}<Badge tone="ok">set</Badge>{:else}<Badge tone="warn"
									>not set</Badge
								>{/if}
							<Button id="uipw" size="sm" onclick={openPasswordDialog}
								>{settings.uiPasswordHash ? 'Change password…' : 'Set password…'}</Button
							>
						</div>
					</Field>
					<Field
						label="API token"
						id="token"
						help={device.tokenPending
							? 'Rotated: the device keeps the old token until it runs its new settings (over the air or USB).'
							: 'Bearer token for the REST API, update pulls and reports.'}
					>
						<div class="flex items-center gap-2">
							<Code
								class="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs"
								>{showToken ? device.apiToken : '•'.repeat(32)}</Code
							>
							<Button
								size="icon"
								variant="ghost"
								aria-label="Show token"
								onclick={() => (showToken = !showToken)}
								>{#if showToken}<EyeOff size={16} />{:else}<Eye size={16} />{/if}</Button
							>
							<CopyButton text={device.apiToken} label="Copy token" />
						</div>
					</Field>
					<div>
						<Button size="sm" variant="ghost" onclick={() => run(() => rotateToken(device.id))}
							><RefreshCw size={14} />Rotate token</Button
						>
					</div>
				</div>
			</Card>

			<!-- A hub is no Matter device: nothing to pair it with. -->
			{#if matter}
				<Card
					title="Matter pairing"
					description="Unique per device. Changing them needs re-pairing."
				>
					<div class="grid gap-4">
						<div class="flex flex-wrap items-center gap-4 rounded-xl bg-surface-2/70 p-4">
							<div>
								<div class="text-xs text-muted">Manual pairing code</div>
								<div
									class="flex items-center gap-1 font-mono text-2xl font-semibold tracking-wider"
								>
									{code}<CopyButton text={code.replaceAll('-', '')} />
								</div>
							</div>
							<div class="min-w-0">
								<div class="text-xs text-muted">QR code payload</div>
								<div class="flex items-center gap-1 font-mono text-sm">
									{qr}<CopyButton text={qr} />
								</div>
							</div>
						</div>
						<div class="grid grid-cols-2 gap-4">
							<Field label="Discriminator" id="disc" help="0–4095">
								<Input
									id="disc"
									type="number"
									min="0"
									max="4095"
									mono
									bind:value={settings.matter.discriminator}
								/>
							</Field>
							<Field
								label="Setup passcode"
								id="pass"
								error={validPasscode(settings.matter.passcode)
									? undefined
									: 'Not an allowed passcode.'}
							>
								<Input
									id="pass"
									type="number"
									min="1"
									max="99999998"
									mono
									invalid={!validPasscode(settings.matter.passcode)}
									bind:value={settings.matter.passcode}
								/>
							</Field>
						</div>
						<div>
							<Button
								size="sm"
								onclick={() => (
									(settings.matter.discriminator = randomDiscriminator()),
									(settings.matter.passcode = randomPasscode())
								)}
							>
								<RefreshCw size={14} />New codes
							</Button>
						</div>
					</div>
				</Card>
			{/if}
		</div>
	</section>

	{#if scopes.length}
		<section class="grid gap-3">
			<h2 class="m-0 text-sm font-semibold text-muted">Features</h2>
			<div class="grid gap-6 lg:grid-cols-2">
				{#each scopes as s (s.scope)}
					{@const values = effectiveScopes.find((e) => e.scope === s.scope)!.settings}
					<Card
						title={s.name}
						description="This device’s values – defaults come from the firmware."
					>
						<div id={s.scope}>
							<SettingsFields
								fields={s.fields}
								settings={values}
								config={effective}
								{resolved}
								{issues}
								scope={s.scope}
								onset={(key, v) => setValue(s.scope, key, v)}
								origin={(key) => origin(s.scope, key, s.settings[key])}
								onreset={(key) => resetValue(s.scope, key)}
							/>
							{#if scoped(s.scope).some((i) => !i.field)}<div class="mt-3">
									<IssueList issues={scoped(s.scope).filter((i) => !i.field)} compact />
								</div>{/if}
						</div>
					</Card>
				{/each}
			</div>
		</section>
	{/if}

	<section class="grid gap-3">
		<h2 class="m-0 text-sm font-semibold text-muted">Connection to the app</h2>
		<div class="grid gap-6 lg:grid-cols-2">
			<Card
				title="App connection"
				description="How the device reaches this app: it reports what it runs (version, settings) after each start and install, and fetches new firmware and settings when pull updates are on."
			>
				<div class="grid gap-4">
					{#if route === 'direct'}
						<Field
							label="App URL"
							id="app-url"
							help="Used for status reports and pull updates. Empty: the public URL under Admin → Settings."
						>
							<Input
								id="app-url"
								mono
								placeholder={device.publicUrl || 'http://192.168.1.10:5173'}
								bind:value={settings.appUrl}
							/>
						</Field>
					{:else if route === 'hub'}
						<p class="m-0 text-sm text-muted">
							Through a hub with the update relay – reports and pulls alike. Thread devices can’t
							reach the app themselves.
						</p>
					{:else}
						<p class="m-0 text-sm text-muted">Needs an IP network.</p>
					{/if}
					<p class="m-0 text-xs text-muted">Last report {relativeTime(device.lastSeenAt)}</p>
				</div>
			</Card>

			<Card
				title="Updates"
				description="How new firmware and settings get onto the device after the first USB flash."
			>
				<div class="grid gap-4">
					<div class="flex items-start gap-3">
						<Toggle label="Updates from the app" bind:checked={settings.updates.pull} />
						<div class="text-sm">
							<div class="font-medium">The device checks for updates</div>
							<div class="text-xs text-muted">
								{#if !settings.updates.pull}Off – it only reports what it runs; updates over USB
									only.{:else if route === 'direct'}Directly from this app, at its App URL.{:else if route === 'hub'}Through
									a hub with the update relay – Thread devices can’t reach the app themselves.{:else}Needs
									an IP network.{/if}
							</div>
						</div>
					</div>
					{#if settings.updates.pull}
						<Field label="Check every" id="interval" help="Minutes (5–1440)">
							<Input
								id="interval"
								type="number"
								min="5"
								max="1440"
								class="max-w-32"
								bind:value={settings.updates.intervalMin}
							/>
						</Field>
					{/if}
					{#if device.kind === 'device' && route === 'hub' && settings.updates.pull}
						<Field
							label="Hub for updates"
							id="hub"
							help="Thread device: its updates come through this hub."
						>
							<Select
								id="hub"
								value={device.hub?.id ?? ''}
								onchange={(e) =>
									run(() =>
										updateDeviceSettings({ id: device.id, hubId: e.currentTarget.value || null })
									)}
							>
								<option value="">— none —</option>
								{#each hubs as h (h.id)}<option value={h.id}>{h.name}</option>{/each}
							</Select>
						</Field>
						{#if !hubs.length}<Notice tone="warn"
								>Create a hub{device.location ? ` in ${device.location.name}` : ''} with the Thread border
								router and update relay features.</Notice
							>{/if}
					{/if}
				</div>
			</Card>

			<Card
				title="Remote access"
				description="Its web interface and REST API at a hostname of its own, from anywhere: the device keeps a connection to this app, and the app passes requests on. Login is the device’s own."
			>
				<div class="grid gap-4">
					{#if !remote}
						<p class="m-0 text-sm text-muted">
							Off – enable the <strong>Remote access</strong> feature in the firmware{device.kind ===
							'device'
								? ' (Wi-Fi devices)'
								: ''}.
						</p>
					{/if}
					{#if device.url}
						<div class="flex flex-wrap items-center gap-2 text-sm">
							{#if remote}
								<Badge tone={device.connectedSince ? 'ok' : 'warn'}
									>{device.connectedSince ? 'connected' : 'offline'}</Badge
								>
							{/if}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the device's own host, not an app route -->
							<a class="font-mono break-all" href={device.url} target="_blank" rel="noreferrer"
								>{device.url}</a
							>
							<CopyButton text={device.url} label="Copy address" />
						</div>
						{#if new URL(device.url).hostname.endsWith('.localhost')}
							<p class="m-0 text-xs text-muted">
								Only on this computer: the app URL is empty or an IP address. Use a domain name to
								reach the device from elsewhere.
							</p>
						{/if}
					{/if}
					<div class="grid gap-2">
						<label for="subdomain" class="text-sm font-medium">Hostname</label>
						<div class="flex gap-2">
							<Input id="subdomain" mono maxlength={63} bind:value={subdomain} />
							{#if remote}
								<Button
									variant="ghost"
									disabled={!device.connectedSince}
									onclick={() => run(async () => (probe = await probeDevice(device.id)))}
									>Test</Button
								>
							{/if}
						</div>
						{#if subdomainError}<p class="m-0 text-xs text-err">{subdomainError}</p>{/if}
						<p class="m-0 flex flex-wrap items-center gap-2 text-xs text-muted">
							{#if probe}<Badge tone={probe.online ? 'ok' : 'err'}
									>{probe.online ? 'answers' : 'no answer'}</Badge
								>{/if}
							<span
								>{#if device.connectedSince}Connected {relativeTime(device.connectedSince)}.{/if}
								With the connection the app also asks the device to check for updates right away after
								you install a build or save settings.</span
							>
						</p>
					</div>
				</div>
			</Card>
		</div>
	</section>
</div>

<Dialog bind:open={passwordOpen} title="Admin password">
	<div class="grid gap-4">
		{#if passwordError}<Notice tone="err">{passwordError}</Notice>{/if}
		<Field
			label="New password"
			id="uipw-new"
			help="8–64 characters. It can’t be shown again once saved – note it down."
		>
			<div class="flex gap-2">
				<Input
					id="uipw-new"
					type={showPassword ? 'text' : 'password'}
					mono
					autocomplete="new-password"
					minlength={8}
					maxlength={64}
					bind:value={newPassword}
				/>
				<Button
					size="icon"
					variant="ghost"
					aria-label="Show password"
					onclick={() => (showPassword = !showPassword)}
					>{#if showPassword}<EyeOff size={16} />{:else}<Eye size={16} />{/if}</Button
				>
				<Button
					size="icon"
					variant="ghost"
					aria-label="Generate password"
					title="Generate one"
					onclick={() => ((newPassword = randomPassword()), (showPassword = true))}
					><RefreshCw size={16} /></Button
				>
				{#if newPassword}<CopyButton text={newPassword} />{/if}
			</div>
		</Field>
	</div>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (passwordOpen = false)}>Cancel</Button>
		<Button
			variant="primary"
			disabled={savingPassword || newPassword.length < 8 || newPassword.length > 64}
			onclick={savePassword}>{savingPassword ? 'Saving…' : 'Save password'}</Button
		>
	{/snippet}
</Dialog>
