<!-- The App link card of a firmware: how it talks to the app; only what is chosen is compiled in. -->
<script lang="ts">
	import type { Issue } from '#sdk';
	import type { Resolved } from '#lib/core/engine.ts';
	import { ACCESS_LABEL, appLink } from '#lib/core/link.ts';
	import type { FirmwareConfig } from '#lib/core/model.ts';
	import { Card, Segmented, Toggle } from '#lib/ui/index.ts';
	import IssueList from './IssueList.svelte';
	import LinkDiagram from './LinkDiagram.svelte';

	let {
		config,
		resolved,
		issues
	}: { config: FirmwareConfig; resolved: Resolved; issues: Issue[] } = $props();

	const link = $derived(appLink(resolved));
	const thread = $derived(config.kind === 'device' && !resolved.has('uplink'));
	const scoped = $derived(issues.filter((i) => i.scope === 'link'));

	/** What the choices put into the firmware. */
	const compiled = $derived(
		[
			link.access === 'tunnel' && 'tunnel to the app',
			link.relay && 'relay for other devices',
			link.viaHub && `finding the hub (${thread ? 'Thread DNS-SD' : 'mDNS'})`
		].filter(Boolean)
	);
</script>

<Card
	title="App link"
	description={config.kind === 'hub'
		? 'How the hub talks to the app, and whether other devices go through it.'
		: 'Where the device gets its updates, and how the app reaches it.'}
>
	<div id="link" class="grid gap-5">
		<LinkDiagram kind={config.kind} {link} {thread} />

		{#if config.kind === 'hub'}
			<div class="grid gap-4">
				<div class="flex items-start gap-3">
					<Toggle
						label="Tunnel to the app"
						checked={link.access === 'tunnel'}
						onchange={(on) => (config.link.access = on ? 'tunnel' : 'off')}
					/>
					<div class="text-sm">
						<div class="font-medium">Tunnel to the app</div>
						<div class="text-xs text-muted">
							The hub keeps a connection open to the app, so the app reaches its web interface and
							REST API from anywhere – no port forwarding.
						</div>
					</div>
				</div>
				<div class="flex items-start gap-3">
					<Toggle label="Relay" bind:checked={config.link.relay} />
					<div class="text-sm">
						<div class="font-medium">Relay for other devices</div>
						<div class="text-xs text-muted">
							Devices without a tunnel of their own report to the app through the hub, and the app
							reaches them through the hub’s tunnel. Thread devices always need one.
						</div>
					</div>
				</div>
				<p class="m-0 text-xs text-muted">
					Updates: the hub pulls its own from the app, at its app URL, and sends paired devices
					theirs over Matter.
				</p>
			</div>
		{:else}
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="grid content-start gap-1.5">
					<span class="text-sm font-medium">Updates</span>
					<p class="m-0 text-xs text-muted">
						Over Matter, from the hub it is paired with – the hub fetches them from the app.
					</p>
				</div>
				<div class="grid content-start gap-1.5">
					<span class="text-sm font-medium">The app reaches it</span>
					<Segmented
						label="The app reaches it"
						value={link.access}
						disabled={link.options.access.length < 2}
						options={link.options.access.map((v) => ({ value: v, label: ACCESS_LABEL[v] }))}
						onchange={(v) => (config.link.access = v as typeof config.link.access)}
					/>
					<p class="m-0 text-xs text-muted">
						{link.access === 'tunnel'
							? 'The device keeps a connection open to the app.'
							: 'Through the tunnel of its hub – the hub needs its relay on.'}
					</p>
				</div>
			</div>
		{/if}

		<p class="m-0 text-xs text-muted">
			In the firmware: {compiled.length ? compiled.join(', ') : 'nothing beyond updates'}.
		</p>
		{#if scoped.length}<IssueList issues={scoped} compact />{/if}
	</div>
</Card>
