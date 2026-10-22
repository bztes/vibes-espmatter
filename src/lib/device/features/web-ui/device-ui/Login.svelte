<script lang="ts">
	import { errorMessage } from './api';
	import { login } from './auth.svelte';
	import Logo from '../../../device-ui/Logo.svelte';
	import { Alert, Button, Input, PasswordInput } from '../../../device-ui/ui';
	import type { DeviceInfo } from './types';

	let { device }: { device: DeviceInfo } = $props();

	let user = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(ev: SubmitEvent) {
		ev.preventDefault();
		busy = true;
		error = '';
		try {
			await login(user.trim(), password);
		} catch (e) {
			error = errorMessage(e);
			password = '';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Log in – {device.name}</title></svelte:head>

<main class="grid min-h-screen place-items-center p-4">
	<form
		class="grid w-[min(340px,100%)] gap-1 rounded-2xl border bg-card px-6 py-7"
		onsubmit={submit}
	>
		<span class="justify-self-center"><Logo size={40} /></span>
		<h1 class="mt-2 mb-4 text-center text-[20px]">{device.name}</h1>
		<Input
			label="User name"
			bind:value={user}
			autocomplete="username"
			autocapitalize="off"
			required
			autofocus
		/>
		<PasswordInput
			label="Password"
			bind:value={password}
			autocomplete="current-password"
			required
		/>
		<Button type="submit" variant="primary" size="lg" class="my-2" disabled={busy}
			>{busy ? 'Logging in…' : 'Log in'}</Button
		>
		{#if error}<Alert>{error}</Alert>{/if}
	</form>
</main>
