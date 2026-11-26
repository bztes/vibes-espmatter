<!-- The Device settings tab: the board's own values (network, login, pairing, features, updates), edited in place and sent by the workspace. -->
<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { slug, type Issue } from '#sdk';
	import { perDeviceScopes } from '#lib/core/device.ts';
	import { randomPassword, resolve as resolveConfig } from '#lib/core/engine.ts';
	import { KINDS } from '#lib/core/kinds.ts';
	import {
		manualPairingCode,
		qrPayload,
		randomDiscriminator,
		randomPasscode,
		validPasscode
	} from '#lib/core/matter.ts';
	import { appLink } from '#lib/core/link.ts';
	import type { DeviceSettings, FirmwareConfig } from '#lib/core/model.ts';
	import { canPull, matterOta } from '#lib/core/platform.ts';
	import type { getDevice } from '#lib/remote/devices.remote.ts';
	import { Badge, Button, Card, CopyButton, Dialog, Field, Input, Toggle } from '#lib/ui/index.ts';
	import IssueList from './IssueList.svelte';
	import SettingsFields from './SettingsFields.svelte';

	let {
		password = $bindable(),
		settings,
		name,
		effective,
		issues,
		device
	}: {
		/** A new admin password, sent with the settings. */
		password: string;
		/** The board's, edited in place, sent by the workspace. */
		settings: DeviceSettings;
		name: string;
		/** The firmware as this device sees it (its values filled in). */
		effective: FirmwareConfig;
		issues: Issue[];
		device: Awaited<ReturnType<typeof getDevice>>;
	} = $props();

	const firmware = $derived(device.firmware.config);
	const resolved = $derived(resolveConfig(effective));
	const link = $derived(appLink(resolved));
	const pull = $derived(canPull(resolved));
	const overMatter = $derived(matterOta(resolved));
	const reachable = $derived(link.access !== 'off');
	const matter = $derived(KINDS[device.kind].matterDevice);
	const scopes = $derived(perDeviceScopes(firmware));
	const code = $derived(manualPairingCode(settings.matter.discriminator, settings.matter.passcode));
	const qr = $derived(
		qrPayload(
			firmware.matter.vendorId,
			firmware.matter.productId,
			settings.matter.discriminator,
			settings.matter.passcode
		)
	);

	let showPassword = $state(false);
	/** The page never has the stored one: only whether there is one. */
	let newPassword = $state('');
	let passwordOpen = $state(false);

	function openPasswordDialog() {
		newPassword = password;
		showPassword = false;
		passwordOpen = true;
	}
	function keepPassword() {
		password = newPassword;
		passwordOpen = false;
	}

	/** The plugin's settings as this device sees them: `when` may depend on firmware fields. */
	const settingsOf = (scope: string) =>
		scope.startsWith('feature:')
			? effective.features[scope.slice('feature:'.length)]
			: effective.peripherals.find((p) => `peripheral:${p.uid}` === scope)!.settings;
	const scoped = (scope: string) => issues.filter((i) => i.scope === scope);
</script>

<div class="grid gap-8">
	<section class="grid gap-3">
		<h2 class="m-0 text-sm font-semibold text-muted">Device</h2>
		<div class="grid gap-6 lg:grid-cols-2">
			<Card title="Network and login">
				<div class="grid gap-4">
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
					<Field label="Admin password" id="uipw">
						<div class="flex items-center gap-3">
							{#if password}<Badge tone="info">new – sent with the settings</Badge
								>{:else if settings.uiPasswordHash}<Badge tone="ok">set</Badge>{:else}<Badge
									tone="warn">not set</Badge
								>{/if}
							<Button id="uipw" size="sm" onclick={openPasswordDialog}
								>{settings.uiPasswordHash || password
									? 'Change password…'
									: 'Set password…'}</Button
							>
						</div>
					</Field>
				</div>
			</Card>

			<!-- A hub is no Matter device: nothing to pair it with. -->
			{#if matter && code && qr}
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
					<Card title={s.name}>
						<div id={s.scope}>
							<SettingsFields
								fields={s.fields}
								settings={settingsOf(s.scope)}
								config={effective}
								{resolved}
								{issues}
								scope={s.scope}
								onset={(key, v) => (settings.plugins[s.scope][key] = v)}
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
		<h2 class="m-0 text-sm font-semibold text-muted">App link</h2>
		<div class="grid gap-6 lg:grid-cols-2">
			{#if link.direct}
				<Card title="App URL">
					<Field
						label="App URL"
						id="app-url"
						help="Where it reaches the app itself ({[
							device.kind === 'hub' && 'updates',
							link.access === 'tunnel' && 'tunnel'
						]
							.filter(Boolean)
							.join(', ')}). Empty: the public URL under Admin → Settings."
					>
						<Input
							id="app-url"
							mono
							placeholder={device.publicUrl || 'http://192.168.1.10:5173'}
							bind:value={settings.appUrl}
						/>
					</Field>
				</Card>
			{/if}

			{#if pull}
				<Card
					title="Updates"
					description="New firmware after the first USB flash, pulled by the hub."
				>
					<div class="grid gap-4">
						<div class="flex items-start gap-3">
							<Toggle label="Updates" bind:checked={settings.updates.pull} />
							<div class="text-sm">
								<div class="font-medium">The hub checks for updates</div>
								<div class="text-xs text-muted">
									{#if !settings.updates.pull}Off – it only reports what it runs; updates over USB
										only.{:else}From the app, at its app URL.{#if reachable}
											The app also asks it to check right away after you install a build.{/if}{/if}
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
					</div>
				</Card>
			{:else if overMatter}
				<Card title="Updates" description="New firmware after the first USB flash.">
					<p class="m-0 text-sm text-muted">
						Over Matter, from the hub it is paired with: the hub fetches the builds you install from
						the app. The device also checks once a day by itself.
					</p>
				</Card>
			{/if}
		</div>
	</section>
</div>

<Dialog bind:open={passwordOpen} title="Admin password">
	<div class="grid gap-4">
		<Field
			label="New password"
			id="uipw-new"
			help="8–64 characters. Sent to the device with its settings; it can’t be shown again – note it down."
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
			disabled={newPassword.length < 8 || newPassword.length > 64}
			onclick={keepPassword}>Use password</Button
		>
	{/snippet}
</Dialog>
