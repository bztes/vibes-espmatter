<!-- The General tab of a device: what the app keeps for it – name, location, API token, link to the app – and deleting it. -->
<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve as path } from '$app/paths';
	import { resolve as resolveConfig } from '#lib/core/engine.ts';
	import { appLink } from '#lib/core/link.ts';
	import type { DeviceSettings, FirmwareConfig } from '#lib/core/model.ts';
	import {
		deleteDevice,
		listHubs,
		probeDevice,
		rotateToken,
		updateDeviceSettings,
		type getDevice
	} from '#lib/remote/devices.remote.ts';
	import { listLocations, moveDevice } from '#lib/remote/locations.remote.ts';
	import {
		Badge,
		Button,
		Card,
		Code,
		CopyButton,
		Field,
		Input,
		Notice,
		relativeTime,
		Select,
		UrlInput
	} from '#lib/ui/index.ts';
	import LinkDiagram from './LinkDiagram.svelte';
	import ManageAction from './ManageAction.svelte';

	let {
		name = $bindable(),
		settings,
		effective,
		device
	}: {
		name: string;
		/** The board's (for its app URL); null: not read (offline). */
		settings: DeviceSettings | null;
		/** The firmware as this device sees it (its values filled in). */
		effective: FirmwareConfig;
		device: Awaited<ReturnType<typeof getDevice>>;
	} = $props();

	const locations = $derived(await listLocations());
	const hubs = $derived(
		device.kind === 'device' ? await listHubs(device.location?.id ?? null) : []
	);
	const resolved = $derived(resolveConfig(effective));
	const link = $derived(appLink(resolved));
	const thread = $derived(device.kind === 'device' && !resolved.has('uplink'));
	/** The app reaches it (its own tunnel or its hub's). */
	const reachable = $derived(link.access !== 'off');
	const appHost = $derived.by(() => {
		try {
			return new URL(settings?.appUrl || device.publicUrl).host;
		} catch {
			return undefined;
		}
	});

	// The subdomain isn't part of the device's configuration: saved on its own, shortly after the
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
	let error = $state('');
	let rotated = $state('');

	async function rotate() {
		rotated = '';
		await run(async () => {
			const r = await rotateToken(device.id);
			rotated = r.applied
				? 'New token sent – the device restarts with it.'
				: `The device gets the new token with its next settings or USB flash (${r.reason}); until then the old one works.`;
		});
	}

	async function run(fn: () => Promise<unknown>) {
		error = '';
		try {
			await fn();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
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
					{#if locations.length}<Field
							label="Location"
							id="location"
							help={device.kind === 'hub'
								? 'Devices of other locations stop using it for updates.'
								: 'Moving it drops a hub of another location. Its Wi-Fi comes from the location unless set here.'}
						>
							<Select
								id="location"
								value={device.location?.id ?? ''}
								onchange={(e) =>
									run(() =>
										moveDevice({ id: device.id, locationId: e.currentTarget.value || null })
									)}
							>
								{#each locations as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
								<option value="">No location</option>
							</Select>
						</Field>{/if}
				</div>
			</Card>

			<Card
				title="REST API"
				description="The token for its REST API; the device also uses it for update pulls and reports to the app."
			>
				<div class="grid gap-4">
					<Field
						label="API token"
						id="token"
						help={device.tokenPending
							? 'Rotated: the device keeps the old token until it gets its new settings (sent from Device settings or with a USB flash).'
							: 'Send it as bearer token.'}
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
						<Button size="sm" variant="ghost" onclick={rotate}
							><RefreshCw size={14} />Rotate token</Button
						>
					</div>
					{#if rotated}<p class="m-0 text-xs text-muted">{rotated}</p>{/if}
				</div>
			</Card>
		</div>
	</section>

	<section class="grid gap-3">
		<h2 class="m-0 text-sm font-semibold text-muted">App link</h2>
		<Card
			title="App link"
			description="How this {device.kind === 'hub'
				? 'hub'
				: 'device'} talks to the app – chosen in its firmware, the addresses here."
		>
			<div class="grid gap-5">
				<LinkDiagram
					kind={device.kind}
					{link}
					{thread}
					name={name || device.name}
					hub={device.hub?.name ?? null}
					app={appHost}
				/>

				{#if link.viaHub}
					<Field
						label="Hub"
						id="hub"
						help="Its {link.updates === 'hub' && link.access === 'hub'
							? 'updates and access go'
							: link.updates === 'hub'
								? 'updates go'
								: 'access goes'} through this hub (its relay must be on)."
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
							>Create a hub{device.location ? ` in ${device.location.name}` : ''} with its relay on.</Notice
						>{:else if !device.hub}<Notice tone="warn">Pick its hub.</Notice>{/if}
				{/if}

				{#if reachable}
					<div class="grid gap-2">
						<label for="subdomain" class="text-sm font-medium">Subdomain</label>
						<div class="flex gap-2">
							<UrlInput
								id="subdomain"
								class="flex-1"
								prefix="{device.deviceDomain.protocol}//"
								suffix=".{device.deviceDomain.domain}{device.deviceDomain.port
									? `:${device.deviceDomain.port}`
									: ''}"
								invalid={!!subdomainError}
								maxlength={63}
								placeholder="name"
								aria-describedby="subdomain-help"
								bind:value={subdomain}
							/>
							<Button
								variant="ghost"
								disabled={!device.connectedSince}
								onclick={() => run(async () => (probe = await probeDevice(device.id)))}>Test</Button
							>
						</div>
						{#if subdomainError}<p class="m-0 text-xs text-err">{subdomainError}</p>{/if}
						{#if device.url}
							<div class="flex flex-wrap items-center gap-2 text-sm">
								<Badge tone={device.connectedSince ? 'ok' : 'warn'}
									>{device.connectedSince
										? device.connectedVia === 'hub'
											? 'through its hub'
											: 'connected'
										: 'offline'}</Badge
								>
								{#if probe}<Badge tone={probe.online ? 'ok' : 'err'}
										>{probe.online ? 'answers' : 'no answer'}</Badge
									>{/if}
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the device's own host, not an app route -->
								<a class="font-mono break-all" href={device.url} target="_blank" rel="noreferrer"
									>{device.url}</a
								>
								<CopyButton text={device.url} label="Copy address" />
							</div>
							{#if new URL(device.url).hostname.endsWith('.localhost')}
								<p class="m-0 text-xs text-muted">
									Only on this computer: the public URL (in the admin settings) is empty or an IP
									address. Use a domain name to reach it from elsewhere.
								</p>
							{/if}
						{/if}
						<p id="subdomain-help" class="m-0 text-xs text-muted">
							Lowercase letters, digits and dashes. Its web interface and REST API, from anywhere;
							login is its own.{#if device.connectedSince}
								{device.connectedVia === 'hub' ? 'Its hub connected' : 'Connected'}
								{relativeTime(device.connectedSince)}.{/if}
						</p>
					</div>
				{:else}
					<p class="m-0 text-sm text-muted">
						The app can’t reach this hub: its tunnel is off in the firmware.
					</p>
				{/if}
				<p class="m-0 text-xs text-muted">Last report {relativeTime(device.lastSeenAt)}</p>
			</div>
		</Card>
	</section>

	<section>
		<Card title="Manage" tone="err">
			<div class="divide-y divide-border">
				<ManageAction
					title="Delete device"
					description="Removes it from this app, with its own values and API token. Its firmware stays."
					label="Delete device…"
					variant="danger"
					confirm="Delete “{device.name}”? This can’t be undone."
					onaction={() =>
						run(async () => {
							await deleteDevice(device.id);
							await goto(path('/(app)'));
						})}
				/>
			</div>
		</Card>
	</section>
</div>
