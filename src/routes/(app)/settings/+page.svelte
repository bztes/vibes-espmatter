<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import Upload from '@lucide/svelte/icons/upload';
	import { page } from '$app/state';
	import PasswordForm from '#lib/components/PasswordForm.svelte';
	import { getMe } from '#lib/remote/auth.remote.ts';
	import { exportMySetup, importMySetup } from '#lib/remote/setup.remote.ts';
	import { Button, Card, Notice } from '#lib/ui/index.ts';
	import { downloadSetup, importedText, pickSetupFile } from '#lib/ui/setup-file.ts';

	const me = $derived(await getMe());
	const passwordSaved = $derived(page.url.searchParams.has('password-saved'));

	let busy = $state(false);
	let result = $state<{ ok: boolean; text: string }>();
	async function run(fn: () => Promise<unknown>) {
		busy = true;
		result = undefined;
		try {
			await fn();
		} catch (e) {
			result = { ok: false, text: e instanceof Error ? e.message : String(e) };
		} finally {
			busy = false;
		}
	}

	const exportSetup = () =>
		run(async () => downloadSetup(await exportMySetup(), me?.email ?? 'me'));
	const importSetup = () =>
		run(async () => {
			const setup = await pickSetupFile();
			if (setup !== undefined)
				result = { ok: true, text: importedText(await importMySetup(setup)) };
		});
</script>

<svelte:head><title>Settings – espmatter studio</title></svelte:head>

<div class="border-b border-border bg-surface">
	<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
		<h1 class="m-0 text-xl font-semibold tracking-tight">Settings</h1>
	</div>
</div>

<div class="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6">
	{#if me}
		<Card title="Account">
			<div class="text-sm">
				<div class="font-medium">{me.name}</div>
				<div class="truncate text-xs text-muted">{me.email}</div>
			</div>
		</Card>
		<Card title="Password" description="Changing it signs out your other sessions.">
			{#if passwordSaved}<Notice tone="ok">Password changed.</Notice>{/if}
			<PasswordForm class="mt-3 max-w-sm" email={me.email} redirectTo="/settings?password-saved" />
		</Card>
	{/if}

	<Card
		title="Setup"
		description="Your locations, firmwares and devices as a file – to move them to another server."
	>
		{#if result}
			<Notice tone={result.ok ? 'ok' : 'err'}>{result.text}</Notice>
		{/if}
		<div class="mt-3 flex flex-wrap gap-2">
			<Button disabled={busy} onclick={exportSetup}><Download size={15} />Export</Button>
			<Button disabled={busy} onclick={importSetup}><Upload size={15} />Import</Button>
		</div>
		<p class="mt-3 mb-0 text-xs text-muted">
			The file holds the devices’ tokens – keep it private. Import adds to your account; the devices
			keep their tokens. To have them talk to this server, build and install their firmwares from
			here.
		</p>
	</Card>
</div>
