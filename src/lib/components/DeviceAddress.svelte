<!--
	The device's last known address with an online indicator (checked every 30 s) and a way to
	change it by hand, e.g. after the router gave the device a new IP.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Pencil from '@lucide/svelte/icons/pencil';
	import X from '@lucide/svelte/icons/x';
	import { probeDevice, setDeviceAddress } from '#lib/api/projects.remote.ts';
	import { DEVICE_ADDRESS, toDeviceUrl } from '#lib/device-address.ts';
	import { errorMessage } from '#lib/errors.ts';
	import { Button, Input, StatusDot } from '#lib/device/device-ui/ui/index.ts';

	let {
		projectId,
		address,
		lastSeenAt
	}: { projectId: string; address: string | null; lastSeenAt?: Date | null } = $props();

	const CHECK_INTERVAL_MS = 30_000;

	let status = $state<'checking' | 'online' | 'offline'>('checking');
	let editing = $state(false);
	let draft = $state('');
	let error = $state('');
	let saving = $state(false);

	const host = $derived(address?.replace(/^http:\/\//, '') ?? '');

	/**
	 * Ask the device directly (an opaque no-cors response is enough to know it answered). Browsers
	 * block http:// requests from https:// pages – then the server asks instead.
	 */
	async function check() {
		if (!address) return;
		const target = address;
		status = 'checking';
		let online: boolean;
		if (location.protocol === 'https:') {
			online = await probeDevice(projectId)
				.then((r) => r.online)
				.catch(() => false);
		} else {
			online = await fetch(new URL('/api/auth/me', target), {
				mode: 'no-cors',
				cache: 'no-store',
				signal: AbortSignal.timeout(3000)
			}).then(
				() => true,
				() => false
			);
		}
		if (target === address) status = online ? 'online' : 'offline';
	}

	onMount(() => {
		const timer = setInterval(
			() => document.visibilityState === 'visible' && check(),
			CHECK_INTERVAL_MS
		);
		return () => clearInterval(timer);
	});

	// Check now and whenever the address changes.
	$effect(() => {
		void address;
		check();
	});

	function edit() {
		draft = host;
		error = '';
		editing = true;
	}

	async function save(ev: SubmitEvent) {
		ev.preventDefault();
		const url = toDeviceUrl(draft);
		if (!DEVICE_ADDRESS.test(url)) {
			error = 'Enter an IP address or host name, e.g. 192.168.1.50';
			return;
		}
		saving = true;
		try {
			await setDeviceAddress({ id: projectId, address: url, manual: true });
			editing = false;
		} catch (err) {
			error = errorMessage(err);
		} finally {
			saving = false;
		}
	}

	const STATUS = {
		checking: { tone: 'muted', label: 'Checking', title: 'Checking…' },
		online: { tone: 'ok', label: 'Online', title: 'The device answers' },
		offline: { tone: 'err', label: 'Offline', title: 'No answer at this address' }
	} as const;
</script>

{#if editing}
	<form
		class="mt-1 mb-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm [&_input]:w-48 [&_input]:px-2 [&_input]:py-[3px]"
		onsubmit={save}
	>
		<span class="text-muted">http://</span>
		<Input
			class="font-mono text-xs"
			bind:value={draft}
			placeholder="192.168.1.50"
			aria-label="Device address"
			autofocus
		/>
		<Button type="submit" icon disabled={saving} aria-label="Save address" title="Save"
			><Check size={16} /></Button
		>
		<Button icon onclick={() => (editing = false)} aria-label="Cancel" title="Cancel"
			><X size={16} /></Button
		>
		{#if error}<span class="w-full text-err">{error}</span>{/if}
	</form>
{:else if address}
	<p class="mt-1 mb-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
		<StatusDot {...STATUS[status]} />
		<span>at</span>
		<!-- eslint-disable svelte/no-navigation-without-resolve -- external device URL -->
		<a
			href={address}
			class="inline-flex items-center gap-1 font-mono text-xs"
			target="_blank"
			rel="noreferrer">{host}<ExternalLink size={13} /></a
		>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
		<Button variant="link" onclick={edit} aria-label="Change address" title="Change address"
			><Pencil size={14} /></Button
		>
		{#if lastSeenAt && status !== 'online'}<span>· last seen {lastSeenAt.toLocaleString()}</span
			>{/if}
	</p>
{:else}
	<p class="mt-1 mb-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
		Address unknown – <Button variant="link" onclick={edit}>set it</Button>
	</p>
{/if}
