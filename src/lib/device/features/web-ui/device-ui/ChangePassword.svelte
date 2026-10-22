<!-- Change your own password: forced after logging in with an initial one, or from the user menu. -->
<script lang="ts">
	import { errorMessage } from './api';
	import { auth, changePassword } from './auth.svelte';
	import { Alert, Button, Input, PasswordInput } from '../../../device-ui/ui';

	let { forced = false, ondone }: { forced?: boolean; ondone?: () => void } = $props();

	let current = $state('');
	let password = $state('');
	let repeat = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(ev: SubmitEvent) {
		ev.preventDefault();
		error = '';
		if (password !== repeat) {
			error = 'The new passwords don’t match.';
			return;
		}
		busy = true;
		try {
			await changePassword(current, password);
			ondone?.();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit}>
	<h2 class="mt-0 mb-2 text-md">{forced ? 'Choose your password' : 'Change password'}</h2>
	{#if forced}<p class="mt-0 mb-3 text-muted">
			You logged in with an initial password – choose your own.
		</p>{/if}
	<Input type="text" autocomplete="username" value={auth.session?.user} hidden />
	<PasswordInput
		label={forced ? 'Password you just used' : 'Current password'}
		bind:value={current}
		autocomplete="current-password"
		required
	/>
	<PasswordInput
		label="New password (min. 6)"
		bind:value={password}
		autocomplete="new-password"
		minlength={6}
		required
	/>
	<PasswordInput
		label="Repeat new password"
		bind:value={repeat}
		autocomplete="new-password"
		required
	/>
	<div class="flex flex-wrap items-center gap-2">
		<Button type="submit" variant="primary" disabled={busy}
			>{busy ? 'Saving…' : 'Save password'}</Button
		>
		{#if !forced}<Button onclick={() => ondone?.()}>Cancel</Button>{/if}
	</div>
	{#if error}<Alert>{error}</Alert>{/if}
</form>
